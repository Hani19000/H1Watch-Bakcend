-- ================================================================
-- MIGRATION 002 — INDEX ET TABLES DE SÉCURITÉ
-- auth-service — Neon PostgreSQL
--
-- Extrait de 002_production_optimizations.sql (monolithe).
-- Contient uniquement les optimisations liées à l'auth-service :
--   - Historique des mots de passe (password_history)
--   - Tokens de réinitialisation (password_reset_tokens)
--   - Fonction de nettoyage unifiée (cleanup_expired_tokens)
--
-- CONCURRENTLY : les index sont créés sans verrouiller les lectures.
-- IF NOT EXISTS : idempotent — sûr à rejouer en cas d'échec partiel.
-- ================================================================

-- ================================================================
-- REFRESH TOKENS — INDEX COMPLÉMENTAIRE
-- Déjà présent dans 001_auth_schema.sql.
-- Répété ici avec IF NOT EXISTS pour les bases existantes
-- qui appliqueraient uniquement la migration 002.
-- ================================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_refresh_tokens_expires
    ON refresh_tokens(expires_at);

COMMENT ON INDEX idx_refresh_tokens_expires IS
    'Nettoyage des sessions expirées (cron : DELETE WHERE expires_at < NOW())';

-- ================================================================
-- HISTORIQUE DES MOTS DE PASSE
--
-- Stocke les N derniers hashs pour empêcher la réutilisation
-- d'un ancien mot de passe (politique de sécurité).
--
-- RGPD : conservation limitée aux 5 dernières versions via trigger.
-- Les hashs ne permettent pas de retrouver le mot de passe en clair.
-- ================================================================

CREATE TABLE IF NOT EXISTS password_history (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL,
    salt          TEXT NOT NULL,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE password_history IS
    'Hashs des anciens mots de passe pour prévenir la réutilisation (max 5 versions, RGPD)';

-- Index composite pour vérifier rapidement l'historique d'un utilisateur
-- et trier par date lors de l'auto-nettoyage du trigger.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_password_history_user_created
    ON password_history(user_id, created_at DESC);

COMMENT ON INDEX idx_password_history_user_created IS
    'Vérification de l''historique MDP et nettoyage automatique (limite 5 entrées)';

-- ── Auto-nettoyage : conserve uniquement les 5 derniers hashs ────────────────
-- Déclenché AFTER INSERT pour ne supprimer qu'après persistance réussie.
-- OFFSET 5 : garde les 5 plus récents, supprime le reste.

CREATE OR REPLACE FUNCTION limit_password_history()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM password_history
    WHERE id IN (
        SELECT id FROM password_history
        WHERE user_id = NEW.user_id
        ORDER BY created_at DESC
        OFFSET 5
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_limit_password_history
    AFTER INSERT ON password_history
    FOR EACH ROW
    EXECUTE FUNCTION limit_password_history();

-- ================================================================
-- TOKENS DE RÉINITIALISATION DE MOT DE PASSE
--
-- SÉCURITÉ :
-- - Seul le hash SHA-256 est stocké (jamais le token brut)
-- - TTL de 1 heure (expires_at DEFAULT)
-- - Usage unique : le token est supprimé après consommation
-- - ON DELETE CASCADE : nettoyage automatique si l'utilisateur est supprimé
-- ================================================================

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT        NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 hour'),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE password_reset_tokens IS
    'Tokens de réinitialisation MDP (SHA-256 uniquement, TTL 1h, usage unique)';

COMMENT ON COLUMN password_reset_tokens.token_hash IS
    'SHA-256 du token brut envoyé par email — le token clair n''est jamais persisté';

-- Validation rapide du token à la consommation (recherche par hash)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_prt_token_hash
    ON password_reset_tokens(token_hash);

-- Purge des anciens tokens avant d'en créer un nouveau pour le même utilisateur
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_prt_user_id
    ON password_reset_tokens(user_id);

-- Nettoyage des tokens expirés par le cron sessions.cron.js
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_prt_expires_at
    ON password_reset_tokens(expires_at);

-- ================================================================
-- FONCTION DE NETTOYAGE UNIFIÉE
--
-- Supprime en une seule transaction atomique :
--   1. Les refresh_tokens expirés (sessions)
--   2. Les password_reset_tokens expirés
--
-- Appelée par sessions.cron.js via : SELECT cleanup_expired_tokens()
-- Retourne le nombre total de lignes supprimées pour le monitoring.
--
-- CTE avec RETURNING : plus performant qu'un COUNT séparé,
-- et garantit l'atomicité des deux DELETE.
-- ================================================================

CREATE OR REPLACE FUNCTION cleanup_expired_tokens()
RETURNS TABLE(deleted_count BIGINT) AS $$
DECLARE
    count_deleted BIGINT;
BEGIN
    WITH deleted_refresh AS (
        DELETE FROM refresh_tokens
        WHERE expires_at < NOW()
        RETURNING id
    ),
    deleted_reset AS (
        DELETE FROM password_reset_tokens
        WHERE expires_at < NOW()
        RETURNING id
    )
    SELECT (SELECT COUNT(*) FROM deleted_refresh) +
           (SELECT COUNT(*) FROM deleted_reset)
    INTO count_deleted;

    RETURN QUERY SELECT count_deleted;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_expired_tokens() IS
    'Supprime les refresh tokens ET les password reset tokens expirés — appelée par le cron sessions';

SELECT '002_indexes terminé' AS status;