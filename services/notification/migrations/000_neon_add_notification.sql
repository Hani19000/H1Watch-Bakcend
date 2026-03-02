-- ================================================================
-- NEON — DELTA MIGRATION : Ajout du schéma notification
-- ================================================================
-- À exécuter EN UNE SEULE FOIS sur un Neon qui a déjà :
--   - Schéma auth    (avec auth_user)
--   - Schéma product (avec product_user)
--   - Schéma "order" (avec order_user)
--   - Schéma payment (avec payment_user)
--   - Schéma cart    (avec cart_user)
--
-- Ce script est idempotent : IF NOT EXISTS sur chaque CREATE.
-- Exécuter en tant que superuser (rôle owner Neon).
--
-- Pourquoi un schéma Neon pour le notification-service :
--   BullMQ ne conserve les jobs échoués que 7 jours.
--   La table notification_logs offre une traçabilité illimitée
--   pour le support client, la compliance et le dashboard admin.
--   Le service reste stateless sur le flux principal (queue Redis),
--   la DB n'est écrite qu'après traitement pour l'audit.
-- ================================================================

-- ── 1. Extension (idempotent) ─────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── 2. Schéma dédié ──────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS notification;

-- ── 3. Rôle applicatif ───────────────────────────────────────────────────────
-- Remplacer le mot de passe par une valeur forte avant d'exécuter.
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'notification_user') THEN
        CREATE ROLE notification_user WITH LOGIN PASSWORD 'CHANGE_ME_notification_password';
    END IF;
END $$;

-- search_path par défaut : toutes les connexions du notification-service
-- voient notification.* sans préfixe de schéma.
ALTER ROLE notification_user SET search_path TO notification, public;

-- ── 4. Tables du schéma notification ──────────────────────────────────────────
SET search_path TO notification, public;

-- Trigger updated_at (déclaré dans chaque schéma — pas de cross-schema)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Enum du statut d'une notification
DO $$ BEGIN
    CREATE TYPE notification_status_enum AS ENUM ('SENT', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ================================================================
-- TABLE : notification_logs
--
-- Log d'audit de chaque notification envoyée ou échouée définitivement.
-- Écrite par le worker BullMQ après traitement final (succès ou échec).
--
-- Pas de FK inter-schéma vers auth.users ou order.orders :
-- le notification-service ne possède pas ces données.
-- Le recipient_email est la seule clé de corrélation nécessaire.
-- ================================================================
CREATE TABLE IF NOT EXISTS notification_logs (
    id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Identifiant BullMQ du job — corrélation entre la DB et la queue Redis
    job_id          VARCHAR(255)  NOT NULL,

    -- Type de notification (NOTIFICATION_TYPES — ex: order.confirmation)
    type            VARCHAR(100)  NOT NULL,

    -- Email du destinataire — référence implicite vers auth.users, sans FK
    recipient_email VARCHAR(255)  NOT NULL,

    status          notification_status_enum NOT NULL,

    -- Nombre de tentatives effectuées par BullMQ avant ce statut final
    attempts        SMALLINT      NOT NULL DEFAULT 1,

    -- Dernier message d'erreur si le job a échoué définitivement
    error_message   TEXT,

    -- Horodatage de l'envoi effectif (null si FAILED)
    sent_at         TIMESTAMP WITH TIME ZONE,

    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE  notification_logs                 IS 'Log d audit des notifications — traçabilité au-delà de la rétention BullMQ (7j)';
COMMENT ON COLUMN notification_logs.job_id          IS 'ID BullMQ du job — corrélation queue Redis ↔ DB';
COMMENT ON COLUMN notification_logs.type            IS 'Type de notification (NOTIFICATION_TYPES) — lisible sans dashboard BullMQ';
COMMENT ON COLUMN notification_logs.recipient_email IS 'Destinataire — référence auth.users sans FK (découplage service)';
COMMENT ON COLUMN notification_logs.attempts        IS 'Nombre de tentatives BullMQ — indicateur de fiabilité Resend';
COMMENT ON COLUMN notification_logs.error_message   IS 'Dernier message d erreur Resend si échec définitif';
COMMENT ON COLUMN notification_logs.sent_at         IS 'Horodatage de l envoi effectif — null si FAILED';

CREATE OR REPLACE TRIGGER update_notification_logs_updated_at
    BEFORE UPDATE ON notification_logs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 5. Index ─────────────────────────────────────────────────────────────────
-- Note : CONCURRENTLY interdit dans un bloc de transaction.

-- Corrélation BullMQ ↔ DB (dédoublonnage si le worker relance)
CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_logs_job_id
    ON notification_logs(job_id);

COMMENT ON INDEX idx_notification_logs_job_id IS
    'Unicité du job_id — évite les doublons si le worker est relancé après un crash';

-- Historique des notifications d'un destinataire (support client)
CREATE INDEX IF NOT EXISTS idx_notification_logs_recipient
    ON notification_logs(recipient_email);

-- Filtrage par type (monitoring, alertes sur un type spécifique)
CREATE INDEX IF NOT EXISTS idx_notification_logs_type
    ON notification_logs(type);

-- Filtrage par statut (dashboard admin, détection des pics d'échecs)
CREATE INDEX IF NOT EXISTS idx_notification_logs_status
    ON notification_logs(status);

-- Tri chronologique pour les dashboards et requêtes de monitoring
CREATE INDEX IF NOT EXISTS idx_notification_logs_created_at
    ON notification_logs(created_at DESC);

-- ── 6. Droits du rôle applicatif ─────────────────────────────────────────────
GRANT USAGE ON SCHEMA notification TO notification_user;

-- Droits sur les tables déjà créées
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA notification TO notification_user;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA notification TO notification_user;

-- Droits sur les futures tables (nouvelles migrations)
ALTER DEFAULT PRIVILEGES IN SCHEMA notification
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO notification_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA notification
    GRANT USAGE, SELECT                  ON SEQUENCES TO notification_user;

-- ── 7. Vérification ──────────────────────────────────────────────────────────
SELECT
    schemaname,
    tablename,
    tableowner
FROM pg_tables
WHERE schemaname = 'notification'
ORDER BY tablename;
