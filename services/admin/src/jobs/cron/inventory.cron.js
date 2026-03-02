/**
 * @module Jobs/Cron/Inventory
 *
 * Libère le stock des paniers abandonnés.
 * Fréquence : toutes les 15 minutes.
 *
 * Délègue à l'order-service qui coordonne avec le product-service
 * pour la libération du stock réservé — l'admin-service ne touche pas la DB.
 */
import { orderClient } from '../../clients/order.client.js';
import { logInfo, logError } from '../../utils/logger.js';

export const inventoryCleanupJob = {
    name: 'inventory-cleanup',
    schedule: '*/15 * * * *',

    async execute() {
        try {
            const result = await orderClient.triggerInventoryCleanup();
            logInfo(`[CRON:INVENTORY] Stock nettoyé — ${result?.processed ?? 0} réservation(s) libérée(s)`);
            return { success: true, result };
        } catch (error) {
            logError(error, { job: 'inventory-cleanup' });
            // Ne pas relancer : permet aux autres crons de continuer en cas d'échec isolé
            return { success: false, error: error.message };
        }
    },
};
