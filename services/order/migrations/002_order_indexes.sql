-- ================================================================
-- Migration 002 — Index de performance + fonction de nettoyage
--
-- Séparé de 001 pour pouvoir être rejoué indépendamment
-- (ex : après un REINDEX sans recréer les tables).
-- ================================================================

SET search_path TO "order", public;

-- ── Index composites orders ───────────────────────────────────────────────────
-- Couvrent les cas d'usage les plus fréquents du dashboard admin et du frontend.

-- Historique utilisateur paginé : ORDER BY created_at DESC WHERE user_id = $1
CREATE INDEX IF NOT EXISTS idx_orders_user_created
    ON orders(user_id, created_at DESC)
    WHERE user_id IS NOT NULL;

-- Filtrage admin par statut + date
CREATE INDEX IF NOT EXISTS idx_orders_status_created
    ON orders(status, created_at DESC);

-- ── Index order_items ─────────────────────────────────────────────────────────
-- Nécessaire pour les rapports de vente par produit (cross-service analytics)
CREATE INDEX IF NOT EXISTS idx_order_items_variant_created
    ON order_items(variant_id, created_at DESC);

-- ================================================================
-- FONCTION : cleanup_abandoned_orders
--
-- Annule les commandes PENDING > 24h et libère le stock réservé.
-- Appelée par le cron quotidien (orders.cron.js).
--
-- NOTE : La libération de stock (inventoryClient.release) est gérée
-- côté Node.js dans orders.service.js#cancelOrderAndReleaseStock.
-- Cette fonction SQL ne gère que le changement de statut en base.
-- Le cron appelle ensuite le service pour la saga compensatoire.
-- ================================================================

CREATE OR REPLACE FUNCTION cleanup_abandoned_orders()
RETURNS TABLE(cancelled_count BIGINT) AS $$
DECLARE
    expired_orders UUID[];
    count_cancelled BIGINT;
BEGIN
    -- Collecte les IDs avant la mise à jour pour les retourner au caller
    SELECT ARRAY_AGG(id) INTO expired_orders
    FROM orders
    WHERE status     = 'PENDING'
      AND created_at < NOW() - INTERVAL '24 hours';

    IF expired_orders IS NULL OR ARRAY_LENGTH(expired_orders, 1) IS NULL THEN
        RETURN QUERY SELECT 0::BIGINT;
        RETURN;
    END IF;

    UPDATE orders
    SET    status     = 'CANCELLED',
           updated_at = NOW()
    WHERE  id = ANY(expired_orders);

    GET DIAGNOSTICS count_cancelled = ROW_COUNT;

    RETURN QUERY SELECT count_cancelled;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_abandoned_orders IS
    'Annule les commandes PENDING > 24h. Appeler depuis le cron Node.js pour la saga de libération de stock.';

-- ── Vue stats rapides ────────────────────────────────────────────────────────
-- Légère : pas de matérialization, requête directe sur les tables.

CREATE OR REPLACE VIEW view_order_stats AS
SELECT
    COUNT(*)                                                           AS total_orders,
    COUNT(*) FILTER (WHERE status = 'PENDING')                         AS pending_orders,
    COUNT(*) FILTER (WHERE status = 'PAID')                            AS paid_orders,
    COUNT(*) FILTER (WHERE status = 'CANCELLED')                       AS cancelled_orders,
    COALESCE(SUM(total_amount) FILTER (WHERE status != 'CANCELLED'), 0) AS total_revenue
FROM orders;

COMMENT ON VIEW view_order_stats IS
    'Statistiques globales des commandes — utilisée par le dashboard admin';