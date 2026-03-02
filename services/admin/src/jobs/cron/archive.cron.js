/**
 * @module Jobs/Cron/Archive
 *
 * Archive les commandes de plus de 2 ans vers la table orders_archive.
 * Fréquence : premier jour du mois à 4h.
 *
 * Délègue à l'order-service propriétaire du schéma "order".
 */
import { orderClient } from '../../clients/order.client.js';
import { logInfo, logError } from '../../utils/logger.js';

export const archiveJob = {
    name: 'orders-archive',
    schedule: '0 4 1 * *',

    async execute() {
        try {
            const result = await orderClient.triggerArchive();
            logInfo(`[CRON:ARCHIVE] ${result?.archivedCount ?? 0} commande(s) archivée(s)`);
            return { success: true, ...result };
        } catch (error) {
            logError(error, { job: 'orders-archive' });
            return { success: false, error: error.message };
        }
    },
};
