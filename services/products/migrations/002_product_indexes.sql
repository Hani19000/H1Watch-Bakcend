-- ================================================================
-- MIGRATION 002 — OPTIMISATIONS PRODUCTION
-- ================================================================

-- ─── orders : Auto-claim guest ──────────────────────────────────────────────
-- Couvert par init-postgres.sql si tu repartes de zéro.
-- Ici pour les bases existantes sans cet index.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_guest_email
    ON orders ((LOWER(shipping_address->>'email')))
    WHERE user_id IS NULL;

COMMENT ON INDEX idx_orders_guest_email IS
    'Auto-claim : recherche des commandes guest par email (index fonctionnel JSONB)';

-- ─── orders : Profil utilisateur ────────────────────────────────────────────
-- Requête la plus fréquente : "mes commandes" + filtre par statut
-- Remplace idx_orders_user et idx_orders_status (qui sont désormais redondants)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_user_status
    ON orders(user_id, status)
    WHERE user_id IS NOT NULL;

COMMENT ON INDEX idx_orders_user_status IS
    'Profil utilisateur : requêtes "mes commandes par statut" (composite optimal)';

-- ─── orders : Historique paginé ──────────────────────────────────────────────
-- Requête : WHERE user_id = X ORDER BY created_at DESC LIMIT n
-- Remplace idx_orders_created (simple created_at = redondant avec ce composite)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_user_created
    ON orders(user_id, created_at DESC)
    WHERE user_id IS NOT NULL;

-- ─── orders : Admin / monitoring ────────────────────────────────────────────
-- Requête : WHERE status = X ORDER BY created_at DESC (tableau de bord admin)
-- Remplace idx_orders_status (non composite = moins performant)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_status_created
    ON orders(status, created_at DESC);

-- ─── orders : Nettoyage des commandes PENDING abandonnées ───────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_pending_old
    ON orders(created_at, status)
    WHERE status = 'PENDING';

COMMENT ON INDEX idx_orders_pending_old IS
    'Cron de nettoyage : commandes PENDING > 24h à annuler';

-- ─── refresh_tokens : Nettoyage des tokens expirés ─────────────────────────
-- Index simple sur expires_at : le cron filtre lui-même WHERE expires_at < NOW().
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_refresh_tokens_expires
    ON refresh_tokens(expires_at);

COMMENT ON INDEX idx_refresh_tokens_expires IS
    'Nettoyage des sessions expirées (cron : DELETE WHERE expires_at < NOW())';

-- ─── payments : Webhooks Stripe ─────────────────────────────────────────────
-- Déjà dans init-postgres.sql. Ici pour bases existantes.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_intent
    ON payments(payment_intent_id)
    WHERE payment_intent_id IS NOT NULL;





BEGIN;

-- ================================================================
-- OPTIMISATION DES CONTRAINTES
-- ================================================================

-- Renforcement de la contrainte de stock (cohérence totale)
ALTER TABLE inventory DROP CONSTRAINT IF EXISTS check_stock_consistency;
ALTER TABLE inventory
    ADD CONSTRAINT check_stock_consistency CHECK (
        available_stock >= 0
        AND reserved_stock >= 0
        AND (available_stock + reserved_stock) >= 0
    );

COMMENT ON CONSTRAINT check_stock_consistency ON inventory IS
    'Garantit la cohérence du stock (disponible + réservé toujours >= 0)';

-- ================================================================
-- ARCHIVAGE DES COMMANDES ANCIENNES
-- ================================================================

CREATE TABLE IF NOT EXISTS orders_archive (
    LIKE orders INCLUDING ALL
);

COMMENT ON TABLE orders_archive IS
    'Archive des commandes > 2 ans (hors requêtes de production)';

-- La version originale faisait INSERT puis DELETE séparément :
-- un crash entre les deux pouvait dupliquer ou perdre des données.
CREATE OR REPLACE FUNCTION archive_old_orders()
RETURNS TABLE(archived_count BIGINT) AS $$
DECLARE
    count_archived BIGINT;
    cutoff_date    TIMESTAMP;
BEGIN
    cutoff_date := NOW() - INTERVAL '2 years';

    -- Transaction interne : garantit que INSERT et DELETE sont atomiques
    -- Si l'une échoue, l'autre est annulée → pas de doublon, pas de perte
    WITH moved AS (
        DELETE FROM orders
        WHERE created_at < cutoff_date
          AND status IN ('DELIVERED', 'CANCELLED', 'REFUNDED')
        RETURNING *
    ),
    inserted AS (
        INSERT INTO orders_archive
        SELECT * FROM moved
        RETURNING id
    )
    SELECT COUNT(*) INTO count_archived FROM inserted;

    RETURN QUERY SELECT count_archived;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION archive_old_orders IS
    'Archive atomique des commandes finalisées > 2 ans (CTE = INSERT + DELETE en une seule transaction)';

-- ================================================================
-- MAINTENANCE AUTOMATIQUE
-- ================================================================

-- Nettoyage des refresh tokens expirés
CREATE OR REPLACE FUNCTION cleanup_expired_tokens()
RETURNS TABLE(deleted_count BIGINT) AS $$
DECLARE
    count_deleted BIGINT;
BEGIN
    WITH deleted AS (
        DELETE FROM refresh_tokens
        WHERE expires_at < NOW()
        RETURNING id
    )
    SELECT COUNT(*) INTO count_deleted FROM deleted;

    RETURN QUERY SELECT count_deleted;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_expired_tokens IS
    'Supprime les refresh tokens expirés (appeler quotidiennement via cron)';

-- Annulation des commandes PENDING abandonnées (> 24h)
CREATE OR REPLACE FUNCTION cleanup_abandoned_orders()
RETURNS TABLE(cancelled_count BIGINT) AS $$
DECLARE
    count_cancelled BIGINT;
BEGIN
    WITH cancelled AS (
        UPDATE orders
        SET    status     = 'CANCELLED',
               updated_at = NOW()
        WHERE  status     = 'PENDING'
          AND  created_at < NOW() - INTERVAL '24 hours'
        RETURNING id
    )
    SELECT COUNT(*) INTO count_cancelled FROM cancelled;

    -- TODO : Appeler inventoryRepo.release() pour libérer le stock réservé
    -- Cette logique est gérée dans orders_service.js#updateOrderStatus côté Node.js

    RETURN QUERY SELECT count_cancelled;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_abandoned_orders IS
    'Annule les commandes PENDING > 24h (appeler quotidiennement via cron)';

-- ================================================================
-- VUE MATÉRIALISÉE — STATISTIQUES DE PERFORMANCE
-- ================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS stats_performance AS
SELECT 'orders_total' AS metric, COUNT(*)::TEXT AS value, NOW() AS updated_at
FROM orders
UNION ALL
SELECT 'orders_pending', COUNT(*)::TEXT, NOW()
FROM orders WHERE status = 'PENDING'
UNION ALL
SELECT 'users_total', COUNT(*)::TEXT, NOW()
FROM users
UNION ALL
SELECT 'users_active_30d', COUNT(DISTINCT user_id)::TEXT, NOW()
FROM orders
WHERE created_at > NOW() - INTERVAL '30 days'
  AND user_id IS NOT NULL
UNION ALL
SELECT 'revenue_30d', COALESCE(SUM(total_amount), 0)::TEXT, NOW()
FROM orders
WHERE created_at > NOW() - INTERVAL '30 days'
  AND status IN ('PAID', 'SHIPPED', 'DELIVERED');

-- Index unique requis pour REFRESH MATERIALIZED VIEW CONCURRENTLY
CREATE UNIQUE INDEX IF NOT EXISTS idx_stats_performance_metric
    ON stats_performance(metric);

COMMENT ON MATERIALIZED VIEW stats_performance IS
    'Statistiques de performance (rafraîchir toutes les heures via refresh_stats())';

-- Fonction de rafraîchissement (cron horaire)
CREATE OR REPLACE FUNCTION refresh_stats()
RETURNS VOID AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY stats_performance;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- VUE MONITORING : REQUÊTES LENTES
-- Nécessite pg_stat_statements activé dans postgresql.conf :
-- shared_preload_libraries = 'pg_stat_statements'
-- ================================================================

CREATE OR REPLACE VIEW view_slow_queries AS
SELECT
    query,
    calls,
    total_exec_time,
    mean_exec_time,
    max_exec_time
FROM pg_stat_statements
WHERE mean_exec_time > 100 -- Plus de 100ms en moyenne
ORDER BY mean_exec_time DESC
LIMIT 20;

COMMENT ON VIEW view_slow_queries IS
    'Requêtes lentes à optimiser (nécessite pg_stat_statements activé)';

-- ================================================================
-- VALIDATION
-- ================================================================

SELECT
    schemaname,
    tablename,
    indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('orders', 'users', 'payments', 'refresh_tokens', 'inventory')
ORDER BY tablename, indexname;

SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
    n_live_tup  AS row_count,
    n_dead_tup  AS dead_rows,
    last_vacuum,
    last_autovacuum
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Index inutilisés (à surveiller après quelques jours de traffic réel)
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan AS index_scans,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND idx_scan = 0
  AND indexrelname NOT LIKE '%_pkey'
ORDER BY pg_relation_size(indexrelid) DESC;

SELECT 'Migration 002 terminée' AS status;

COMMIT;

-- ================================================================
-- SÉCURITÉ : HISTORIQUE DES MOTS DE PASSE
-- ================================================================

CREATE TABLE IF NOT EXISTS password_history (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL,
    salt          TEXT NOT NULL,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE password_history IS 
    'Stocke les anciens hashs pour empêcher la réutilisation (RGPD: conservation limitée)';

-- Fonction pour limiter l'historique aux 5 derniers hashs (auto-cleanup)
CREATE OR REPLACE FUNCTION limit_password_history()
RETURNS TRIGGER AS $$
BEGIN
    -- Supprime les entrées les plus anciennes si on dépasse 5 versions
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

-- Trigger pour déclencher le nettoyage à chaque ajout
CREATE OR REPLACE TRIGGER trg_limit_password_history
AFTER INSERT ON password_history
FOR EACH ROW
EXECUTE FUNCTION limit_password_history();

-- Index ajouté APRÈS la création de la table (dépendance obligatoire)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_password_history_user_created
    ON password_history(user_id, created_at DESC);

COMMENT ON INDEX idx_password_history_user_created IS
    'Optimisation de la vérification de l''historique des MDP (Service Layer)';


-- Création de la fonction de rafraîchissement
CREATE OR REPLACE FUNCTION refresh_stats()
RETURNS VOID AS $$
BEGIN
    -- Utilise CONCURRENTLY pour ne pas bloquer les lectures pendant le refresh
    REFRESH MATERIALIZED VIEW CONCURRENTLY stats_performance;
END;
$$ LANGUAGE plpgsql;

ALTER TYPE order_status_enum ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE order_status_enum ADD VALUE IF NOT EXISTS 'REFUNDED';



CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT        NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 hour'),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE password_reset_tokens IS
    'Tokens de réinitialisation de mot de passe (hash SHA-256 uniquement, TTL 1h, usage unique)';

COMMENT ON COLUMN password_reset_tokens.token_hash IS
    'SHA-256 du token brut envoyé par email — jamais le token en clair';

-- Index pour la validation rapide du token à la consommation
CREATE INDEX IF NOT EXISTS idx_prt_token_hash
    ON password_reset_tokens(token_hash);

-- Index pour purger les anciens tokens d'un utilisateur avant d'en créer un nouveau
CREATE INDEX IF NOT EXISTS idx_prt_user_id
    ON password_reset_tokens(user_id);

-- Index pour le cron de nettoyage des tokens expirés (réutilise cleanup_expired_tokens)
CREATE INDEX IF NOT EXISTS idx_prt_expires_at
    ON password_reset_tokens(expires_at);

-- Extension du cron existant pour nettoyer également les tokens de reset expirés
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
    'Supprime les refresh tokens ET les password reset tokens expirés (cron quotidien)';

SELECT 'Migration 003 terminée' AS status;