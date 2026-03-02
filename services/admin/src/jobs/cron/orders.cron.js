/**
 * @module Jobs/Cron/Orders
 *
 * Annule les commandes PENDING > 24h et libère le stock associé.
 * Fréquence : tous les jours à 3h30.
 *
 * Délègue à l'order-service propriétaire du schéma "order".
 */
import { orderClient } from '../../clients/order.client.js';
import { logInfo, logError } from '../../utils/logger.js';

export const ordersCleanupJob = {
    name: 'orders-cleanup',
    schedule: '30 3 * * *',

    async execute() {
        try {
            const result = await orderClient.triggerOrdersCleanup();
            logInfo(`[CRON:ORDERS] ${result?.cancelledCount ?? 0} commande(s) annulée(s)`);
            return { success: true, ...result };
        } catch (error) {
            logError(error, { job: 'orders-cleanup' });
            return { success: false, error: error.message };
        }
    },
};
