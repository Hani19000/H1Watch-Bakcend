-- ================================================================
-- Migration 001 — Schéma "order"
-- order-service : tables orders, order_items, payments, shipments
--
-- Isolées dans le schéma "order" pour éviter toute collision avec
-- le monolith. Le search_path de ce service est positionné à "order"
-- via pgPool.on('connect'), les noms de tables sont donc non préfixés
-- dans le code applicatif.
--
-- Références cross-schéma :
--   auth.users          → via user_id (pas de FK contrainte inter-service)
--   product.product_variants → via variant_id (idem)
--   Les FK inter-schémas sont volontairement omises pour permettre
--   l'évolution indépendante des services.
-- ================================================================

-- Nécessaire pour uuid_generate_v4()
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Schéma dédié ─────────────────────────────────────────────────────────────
-- "order" est un mot réservé SQL, les guillemets sont obligatoires.

CREATE SCHEMA IF NOT EXISTS "order";

-- Positionne le search_path pour cette session de migration uniquement
SET search_path TO "order", public;

-- ── Types ENUM ────────────────────────────────────────────────────────────────

DO $$ BEGIN
    CREATE TYPE order_status_enum AS ENUM (
        'PENDING',
        'PAID',
        'PROCESSING',
        'SHIPPED',
        'DELIVERED',
        'CANCELLED',
        'REFUNDED'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE payment_status_enum AS ENUM ('PENDING', 'SUCCESS', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Trigger partagé : mise à jour automatique de updated_at ──────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- TABLE : orders
-- ================================================================

CREATE TABLE IF NOT EXISTS orders (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_number    VARCHAR(50) UNIQUE NOT NULL, -- Format : ORD-2026-1708097550 (généré par trigger)
    user_id         UUID,                         -- NULL = commande guest (pas de FK inter-service)

    status          order_status_enum DEFAULT 'PENDING',

    -- Ventilation des montants — snapshot au moment du checkout
    subtotal_amount NUMERIC(10,2) NOT NULL,
    shipping_cost   NUMERIC(10,2) DEFAULT 0.00,
    shipping_method VARCHAR(50),
    tax_amount      NUMERIC(10,2) DEFAULT 0.00,
    tax_rate        NUMERIC(5,2)  DEFAULT 0.00,
    discount_amount NUMERIC(10,2) DEFAULT 0,
    total_amount    NUMERIC(10,2) NOT NULL,

    -- Adresses en JSONB : flexibilité sans migration de schéma
    -- shipping_address.email est utilisé pour l'auto-claim guest
    shipping_address JSONB NOT NULL,
    billing_address  JSONB,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON COLUMN orders.order_number    IS 'Format ORD-YYYY-TIMESTAMP, généré automatiquement par trigger';
COMMENT ON COLUMN orders.user_id         IS 'NULL = commande guest. Non NULL = commande rattachée à un compte auth';
COMMENT ON COLUMN orders.subtotal_amount IS 'Total produits HT (avant frais et taxes)';
COMMENT ON COLUMN orders.shipping_cost   IS 'Frais de port HT';
COMMENT ON COLUMN orders.shipping_method IS 'Mode de livraison : STANDARD, EXPRESS, RELAY';
COMMENT ON COLUMN orders.tax_amount      IS 'Montant de la TVA calculée';
COMMENT ON COLUMN orders.tax_rate        IS 'Taux de TVA appliqué (en pourcentage)';
COMMENT ON COLUMN orders.total_amount    IS 'Montant total TTC (produits + frais + TVA - réductions)';

-- Génération du numéro de commande lisible et unique
CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TRIGGER AS $$
BEGIN
    -- Secondes epoch pour unicité sans collision sur des insertions simultanées
    NEW.order_number := 'ORD-' || TO_CHAR(NOW(), 'YYYY') || '-' || (EXTRACT(EPOCH FROM NOW())::BIGINT);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trigger_generate_order_number
    BEFORE INSERT ON orders
    FOR EACH ROW EXECUTE FUNCTION generate_order_number();

CREATE OR REPLACE TRIGGER update_orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Index critique pour l'auto-claim : recherche par email dans le JSONB guest uniquement
CREATE INDEX IF NOT EXISTS idx_orders_guest_email
    ON orders ((LOWER(shipping_address->>'email')))
    WHERE user_id IS NULL;

COMMENT ON INDEX idx_orders_guest_email IS
    'Auto-claim : recherche rapide des commandes guest par email (index fonctionnel JSONB)';

CREATE INDEX IF NOT EXISTS idx_orders_number ON orders(order_number);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

-- ================================================================
-- TABLE : order_items
-- ================================================================

CREATE TABLE IF NOT EXISTS order_items (
    id                 BIGSERIAL PRIMARY KEY,
    order_id           UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    variant_id         UUID,          -- Référence product.product_variants — pas de FK inter-service
    product_name       VARCHAR(255) NOT NULL, -- Snapshot du nom au moment de la commande
    variant_attributes JSONB,
    unit_price         NUMERIC(10,2) NOT NULL, -- Snapshot du prix (ne jamais recalculer depuis product)
    quantity           INT NOT NULL CHECK (quantity > 0),
    created_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON COLUMN order_items.product_name IS 'Snapshot du nom produit — ne pas joindre products pour recalcul';
COMMENT ON COLUMN order_items.unit_price   IS 'Snapshot du prix unitaire — ne pas recalculer depuis product_variants';
COMMENT ON COLUMN order_items.variant_id   IS 'Référence product.product_variants — pas de FK inter-schéma';

CREATE INDEX IF NOT EXISTS idx_order_items_order   ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_variant ON order_items(variant_id);

-- ================================================================
-- TABLE : payments
-- ================================================================

CREATE TABLE IF NOT EXISTS payments (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id          UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    provider          VARCHAR(50),           -- Ex : 'STRIPE', 'PAYPAL'
    payment_intent_id VARCHAR(255),          -- Identifiant externe du provider
    status            payment_status_enum DEFAULT 'PENDING',
    amount            NUMERIC(10,2) NOT NULL,
    currency          VARCHAR(3) DEFAULT 'EUR',
    metadata          JSONB,                 -- Données additionnelles (erreurs, détails provider)
    created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON COLUMN payments.metadata IS 'Données additionnelles : erreurs, détails provider, etc.';

CREATE INDEX IF NOT EXISTS idx_payments_intent ON payments(payment_intent_id)
    WHERE payment_intent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_order_status ON payments(order_id, status);

CREATE OR REPLACE TRIGGER update_payments_updated_at
    BEFORE UPDATE ON payments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ================================================================
-- TABLE : shipments
-- ================================================================

CREATE TABLE IF NOT EXISTS shipments (
    id              BIGSERIAL PRIMARY KEY,
    order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    carrier         VARCHAR(100),
    tracking_number VARCHAR(255),
    shipped_at      TIMESTAMP WITH TIME ZONE,
    delivered_at    TIMESTAMP WITH TIME ZONE,
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_shipment_order UNIQUE (order_id)  -- Une expédition par commande
);

CREATE INDEX IF NOT EXISTS idx_shipments_order ON shipments(order_id);