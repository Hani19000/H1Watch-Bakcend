/**
 * @module Jobs/Cron/Orders
 *
 * Annule les commandes PENDING > 24h et libère le stock associé.
 * Fréquence : tous les jours à 3h30.
 */
import { pgPool } from '../config/database.js';
import { logInfo, logError } from '../utils/logger.js';

export const ordersCleanupJob = {
    name: 'orders-cleanup',
    schedule: '30 3 * * *',

    async execute() {
        try {
            const { rows } = await pgPool.query('SELECT cleanup_abandoned_orders()');
            const count = rows[0]?.cleanup_abandoned_orders || 0;

            logInfo(`[CRON:ORDERS] ${count} commande(s) annulée(s)`);
            return { success: true, cancelledCount: count };
        } catch (error) {
            logError(error, { job: 'orders-cleanup' });
            return { success: false, error: error.message };
        }
    },
};