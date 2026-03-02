-- ================================================================
-- MIGRATION 001 — AUTH SCHEMA
-- auth-service — Neon PostgreSQL
--
-- Contient uniquement les tables nécessaires à l'authentification
-- et à la gestion des utilisateurs.
--
-- Tables extraites du monolithe init-postgres.sql :
--   users, roles, user_roles, refresh_tokens
--
-- Les tables métier (products, orders, payments, etc.)
-- appartiennent à leurs services respectifs.
-- ================================================================

-- ================================================================
-- EXTENSIONS
-- uuid-ossp  : génération d'UUID v4 (uuid_generate_v4())
-- pgcrypto   : génération d'UUID cryptographiquement sûr (gen_random_uuid())
-- IF NOT EXISTS : idempotent — peut être exécuté sur une base existante
-- ================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ================================================================
-- ENUM
-- Séparé du monolithe : seul user_role_enum appartient à l'auth-service.
-- Les enums order_status, payment_status, etc. restent dans leurs services.
-- ================================================================

CREATE TYPE user_role_enum AS ENUM ('USER', 'ADMIN');

-- ================================================================
-- FONCTION UTILITAIRE : mise à jour automatique de updated_at
-- Déclarée avant les triggers qui en dépendent.
-- OR REPLACE : idempotent pour les migrations successives.
-- ================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- USERS
--
-- email UNIQUE crée automatiquement un index B-tree (pas besoin
-- d'en ajouter un manuellement).
--
-- salt stocké séparément du hash : permet la migration vers
-- un algorithme différent sans perte de données.
-- ================================================================

CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email         VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT        NOT NULL,
    salt          TEXT        NOT NULL,
    first_name    VARCHAR(100),
    last_name     VARCHAR(100),
    phone         VARCHAR(20),
    is_active     BOOLEAN     DEFAULT TRUE,
    created_at    TIMESTAMP   DEFAULT NOW(),
    updated_at    TIMESTAMP   DEFAULT NOW()
);

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ================================================================
-- ROLES
--
-- SMALLINT GENERATED ALWAYS AS IDENTITY : séquence gérée par la DB,
-- impossible de passer un id arbitraire (sécurité contre les injections
-- de rôles non déclarés).
--
-- user_roles : table de jonction avec CASCADE pour nettoyer automatiquement
-- les rôles orphelins lors de la suppression d'un compte.
-- ================================================================

CREATE TABLE roles (
    id   SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name user_role_enum UNIQUE NOT NULL
);

CREATE TABLE user_roles (
    user_id UUID     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id SMALLINT NOT NULL REFERENCES roles(id),
    PRIMARY KEY (user_id, role_id)
);

-- Données initiales obligatoires : tous les rôles possibles
INSERT INTO roles (name) VALUES ('USER'), ('ADMIN');

-- ================================================================
-- REFRESH TOKENS
--
-- ON DELETE CASCADE : toutes les sessions sont automatiquement
-- révoquées lors de la suppression du compte (RGPD).
--
-- expires_at indexé pour le cron de nettoyage quotidien.
-- user_id indexé pour le logout global (invalidation de toutes
-- les sessions d'un utilisateur simultanément).
-- ================================================================

CREATE TABLE refresh_tokens (
    id         BIGSERIAL PRIMARY KEY,
    user_id    UUID      REFERENCES users(id) ON DELETE CASCADE,
    token      TEXT      UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Invalidation de toutes les sessions d'un utilisateur (logout global, ban)
CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);

-- Nettoyage des tokens expirés par le cron sessions.cron.js
CREATE INDEX idx_refresh_tokens_expires ON refresh_tokens(expires_at);