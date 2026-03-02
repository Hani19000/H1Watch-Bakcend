-- ================================================================
-- Migration 002 — Index schéma "payment"
-- ================================================================

SET search_path TO payment, public;

-- Recherche par payment_intent_id lors du traitement des webhooks Stripe.
-- Stripe peut renvoyer le même event — cet index accélère la vérification d'idempotence.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_intent
    ON payments(payment_intent_id)
    WHERE payment_intent_id IS NOT NULL;

-- Historique des paiements d'une commande (support client, remboursements).
CREATE INDEX IF NOT EXISTS idx_payments_order_id
    ON payments(order_id);

-- Filtrage par statut pour les tableaux de bord et les tâches de réconciliation.
CREATE INDEX IF NOT EXISTS idx_payments_status
    ON payments(status);

-- Recherche par session Stripe (vérification de statut post-redirection).
CREATE INDEX IF NOT EXISTS idx_payments_session
    ON payments(session_id)
    WHERE session_id IS NOT NULL;