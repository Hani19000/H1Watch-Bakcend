/**
 * @module Jobs/Cron/Stats
 *
 * Met à jour les vues matérialisées des statistiques du dashboard.
 * Fréquence : toutes les heures.
 *
 * Délègue à l'order-service et invalide le cache du dashboard
 * pour que le prochain appel recharge des données fraîches.
 */
import { orderClient } from '../../clients/order.client.js';
import { cacheService } from '../../services/cache.service.js';
import { logInfo, logError } from '../../utils/logger.js';

const DASHBOARD_CACHE_KEY = 'dashboard:stats';

export const statsRefreshJob = {
    name: 'stats-refresh',
    schedule: '0 * * * *',

    async execute() {
        try {
            await orderClient.triggerStatsRefresh();
            // Invalider le cache pour forcer un rechargement lors du prochain accès au dashboard
            await cacheService.delete(DASHBOARD_CACHE_KEY);
            logInfo('[CRON:STATS] Stats rafraîchies, cache invalidé');
            return { success: true };
        } catch (error) {
            logError(error, { job: 'stats-refresh' });
            return { success: false, error: error.message };
        }
    },
};
