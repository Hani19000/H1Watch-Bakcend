-- ================================================================
-- Migration 002 — Index schéma "notification"
--
-- Note : CREATE INDEX CONCURRENTLY est interdit dans une transaction.
-- Exécuter ce fichier hors BEGIN/COMMIT (psql par défaut convient).
-- ================================================================

SET search_path TO notification, public;

-- Dédoublonnage si le worker est relancé après un crash partiel.
-- Un job BullMQ ne doit produire qu'une seule entrée de log.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_logs_job_id
    ON notification_logs(job_id);

COMMENT ON INDEX idx_notification_logs_job_id IS
    'Unicité du job_id — prévient les doublons en cas de crash du worker';

-- Historique des notifications d'un destinataire.
-- Utilisé par le support client ("a-t-on bien envoyé la confirmation à cet email ?")
CREATE INDEX IF NOT EXISTS idx_notification_logs_recipient
    ON notification_logs(recipient_email);

-- Filtrage par type de notification.
-- Utilisé pour détecter un pic d'échecs sur un type spécifique (ex: order.shipped).
CREATE INDEX IF NOT EXISTS idx_notification_logs_type
    ON notification_logs(type);

-- Filtrage par statut pour le dashboard admin et les alertes monitoring.
CREATE INDEX IF NOT EXISTS idx_notification_logs_status
    ON notification_logs(status);

-- Tri chronologique DESC pour les dashboards et les requêtes de monitoring.
-- Couvre les requêtes "dernières N notifications" sans full scan.
CREATE INDEX IF NOT EXISTS idx_notification_logs_created_at
    ON notification_logs(created_at DESC);

-- Index composite pour les requêtes d'audit fréquentes :
-- "toutes les notifications FAILED de type order.confirmation cette semaine"
CREATE INDEX IF NOT EXISTS idx_notification_logs_status_type_created
    ON notification_logs(status, type, created_at DESC);
