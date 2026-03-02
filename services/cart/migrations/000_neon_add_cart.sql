-- ================================================================
-- NEON — DELTA MIGRATION : Ajout du schéma cart
-- ================================================================
-- À exécuter EN UNE SEULE FOIS sur un Neon qui a déjà :
--   - Schéma auth    (avec auth_user)
--   - Schéma product (avec product_user)
--   - Schéma "order" (avec order_user)
--   - Schéma payment (avec payment_user)
--
-- Ce script est idempotent : IF NOT EXISTS sur chaque CREATE.
-- Exécuter en tant que superuser (rôle owner Neon).
--
-- NOTE : Les tables order.carts et order.cart_items du monolith
-- restent intactes pour l'historique. Le cart-service écrit
-- exclusivement dans le schéma "cart".
-- ================================================================

-- ── 1. Extension (idempotent) ─────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── 2. Schéma dédié ──────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS cart;

-- ── 3. Rôle applicatif ───────────────────────────────────────────────────────
-- Remplacer le mot de passe par une valeur forte avant d'exécuter.
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cart_user') THEN
        CREATE ROLE cart_user WITH LOGIN PASSWORD 'CHANGE_ME_cart_password';
    END IF;
END $$;

-- search_path par défaut : toutes les connexions du cart-service
-- voient cart.* sans préfixe de schéma.
ALTER ROLE cart_user SET search_path TO cart, public;

-- ── 4. Tables du schéma cart ──────────────────────────────────────────────────
SET search_path TO cart, public;

-- Trigger updated_at (déclaré dans chaque schéma — pas de cross-schema)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- TABLE : carts
--
-- Un panier par utilisateur authentifié.
-- Le user_id référence auth.users — pas de FK inter-schéma (découplage).
-- ================================================================
CREATE TABLE IF NOT EXISTS carts (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Référence vers auth.users — pas de FK inter-schéma (découplage service)
    user_id    UUID UNIQUE,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE  carts         IS 'Un panier par utilisateur — cart-service';
COMMENT ON COLUMN carts.user_id IS 'Référence auth.users — pas de FK inter-schéma (découplage)';

CREATE OR REPLACE TRIGGER update_carts_updated_at
    BEFORE UPDATE ON carts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ================================================================
-- TABLE : cart_items
--
-- Articles du panier. variant_id référence product.product_variants
-- sans FK inter-schéma pour maintenir le découplage.
-- La contrainte UNIQUE (cart_id, variant_id) garantit qu'un même
-- article ne peut pas être dupliqué — addItem cumule les quantités.
-- ================================================================
CREATE TABLE IF NOT EXISTS cart_items (
    id         BIGSERIAL PRIMARY KEY,

    cart_id    UUID NOT NULL REFERENCES carts(id) ON DELETE CASCADE,

    -- Référence product.product_variants — pas de FK inter-schéma (découplage)
    variant_id UUID NOT NULL,

    quantity   INT NOT NULL CHECK (quantity > 0),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT unique_cart_variant UNIQUE (cart_id, variant_id)
);

COMMENT ON TABLE  cart_items            IS 'Articles du panier — cart-service';
COMMENT ON COLUMN cart_items.variant_id IS 'Référence product.product_variants — pas de FK inter-schéma (découplage)';
COMMENT ON COLUMN cart_items.updated_at IS 'Utilisé par le cron de nettoyage des paniers inactifs';

CREATE OR REPLACE TRIGGER update_cart_items_updated_at
    BEFORE UPDATE ON cart_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 5. Index ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_carts_user_id
    ON carts(user_id)
    WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cart_items_cart
    ON cart_items(cart_id);

CREATE INDEX IF NOT EXISTS idx_cart_items_variant
    ON cart_items(variant_id);

-- Pour le cron de nettoyage des paniers inactifs
CREATE INDEX IF NOT EXISTS idx_cart_items_updated_at
    ON cart_items(updated_at);

-- ── 6. Droits du rôle applicatif ─────────────────────────────────────────────
GRANT USAGE ON SCHEMA cart TO cart_user;

-- Droits sur les tables déjà créées
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA cart TO cart_user;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA cart TO cart_user;

-- Droits sur les futures tables (nouvelles migrations)
ALTER DEFAULT PRIVILEGES IN SCHEMA cart
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO cart_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA cart
    GRANT USAGE, SELECT                  ON SEQUENCES TO cart_user;

-- ── 7. Vérification ──────────────────────────────────────────────────────────
SELECT
    schemaname,
    tablename,
    tableowner
FROM pg_tables
WHERE schemaname = 'cart'
ORDER BY tablename;
