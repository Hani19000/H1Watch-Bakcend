-- ================================================================
-- Migration 001 — Schéma "notification"
-- notification-service : table notification_logs
--
-- Isolée dans le schéma "notification" pour respecter la séparation
-- des responsabilités entre services.
--
-- Rôle de cette table :
--   Log d'audit persistant des notifications envoyées ou échouées.
--   BullMQ conserve les jobs max 7 jours — cette table offre une
--   traçabilité illimitée pour le support, la compliance et l'admin.
--
--   Le worker écrit ici APRÈS traitement final (succès ou épuisement
--   des tentatives). Le flux principal reste Redis/BullMQ.
--
-- Références cross-schéma :
--   auth.users → via recipient_email (pas de FK inter-schéma)
--   Les FK inter-schémas sont omises pour permettre l'évolution
--   indépendante des services.
-- ================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE SCHEMA IF NOT EXISTS notification;

SET search_path TO notification, public;

-- ── Type ENUM ─────────────────────────────────────────────────────────────────

DO $$ BEGIN
    CREATE TYPE notification_status_enum AS ENUM ('SENT', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Trigger partagé ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- TABLE : notification_logs
-- ================================================================

CREATE TABLE IF NOT EXISTS notification_logs (
    id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id          VARCHAR(255)  NOT NULL,
    type            VARCHAR(100)  NOT NULL,
    recipient_email VARCHAR(255)  NOT NULL,
    status          notification_status_enum NOT NULL,
    attempts        SMALLINT      NOT NULL DEFAULT 1,
    error_message   TEXT,
    sent_at         TIMESTAMP WITH TIME ZONE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON COLUMN notification_logs.job_id          IS 'ID BullMQ — corrélation queue Redis ↔ DB';
COMMENT ON COLUMN notification_logs.type            IS 'Type de notification (NOTIFICATION_TYPES)';
COMMENT ON COLUMN notification_logs.recipient_email IS 'Destinataire — référence auth.users sans FK (découplage)';
COMMENT ON COLUMN notification_logs.attempts        IS 'Tentatives BullMQ — indicateur de fiabilité Resend';
COMMENT ON COLUMN notification_logs.error_message   IS 'Dernier message d erreur si échec définitif';
COMMENT ON COLUMN notification_logs.sent_at         IS 'Horodatage envoi effectif — null si FAILED';

CREATE OR REPLACE TRIGGER update_notification_logs_updated_at
    BEFORE UPDATE ON notification_logs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
