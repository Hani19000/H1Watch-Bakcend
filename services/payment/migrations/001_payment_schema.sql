-- ================================================================
-- Migration 001 — Schéma "payment"
-- payment-service : table payments
--
-- Isolée dans le schéma "payment" pour respecter la séparation
-- des responsabilités entre services.
--
-- NOTE : Une table `payments` existe déjà dans le schéma "order"
-- (héritée de la période monolithique). Cette table est indépendante
-- et sera laissée en place pour préserver l'historique. Le
-- payment-service écrit exclusivement dans `payment.payments`.
--
-- Références cross-schéma :
--   order.orders → via order_id (pas de FK contrainte inter-service)
--   Les FK inter-schémas sont volontairement omises pour permettre
--   l'évolution indépendante des services.
-- ================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Schéma dédié ─────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS payment;

SET search_path TO payment, public;

-- ── Type ENUM ─────────────────────────────────────────────────────────────────

DO $$ BEGIN
    CREATE TYPE payment_status_enum AS ENUM ('PENDING', 'SUCCESS', 'FAILED');
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
-- TABLE : payments
--
-- Enregistre chaque tentative de paiement et son issue.
-- Source de vérité pour la réconciliation avec Stripe.
-- ================================================================

CREATE TABLE IF NOT EXISTS payments (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Référence vers la commande dans order.orders — pas de FK inter-schéma
    order_id          UUID NOT NULL,

    -- Identifiants du prestataire de paiement
    provider          VARCHAR(50) NOT NULL DEFAULT 'STRIPE',
    payment_intent_id VARCHAR(255),          -- payment_intent Stripe (pi_...)
    session_id        VARCHAR(255),          -- checkout session Stripe (cs_...)

    status            payment_status_enum NOT NULL DEFAULT 'PENDING',

    amount            NUMERIC(10,2) NOT NULL,
    currency          VARCHAR(3)    NOT NULL DEFAULT 'EUR',

    -- Données brutes du webhook pour la traçabilité et le support
    metadata          JSONB,

    created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON COLUMN payments.order_id          IS 'Référence order.orders — pas de FK inter-schéma';
COMMENT ON COLUMN payments.payment_intent_id IS 'ID Stripe du payment_intent (pi_...) — clé de réconciliation';
COMMENT ON COLUMN payments.session_id        IS 'ID Stripe du checkout session (cs_...) — utile pour le suivi';
COMMENT ON COLUMN payments.metadata          IS 'Données brutes du webhook Stripe pour traçabilité et support';

CREATE OR REPLACE TRIGGER update_payments_updated_at
    BEFORE UPDATE ON payments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();