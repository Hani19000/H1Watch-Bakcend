/**
 * @module Jobs
 *
 * Point d'entrée unique pour les cron jobs du admin-service.
 * Appelé une seule fois au démarrage de l'application.
 */
import { cronScheduler } from './schedulers/cronScheduler.js';
import { inventoryCleanupJob } from './cron/inventory.cron.js';
import { sessionsCleanupJob } from './cron/sessions.cron.js';
import { ordersCleanupJob } from './cron/orders.cron.js';
import { statsRefreshJob } from './cron/stats.cron.js';
import { archiveJob } from './cron/archive.cron.js';

export function initializeCronJobs() {
    cronScheduler.registerMany([
        inventoryCleanupJob, // Toutes les 15 minutes
        sessionsCleanupJob,  // 1x/jour à 3h
        ordersCleanupJob,    // 1x/jour à 3h30
        statsRefreshJob,     // Toutes les heures
        archiveJob,          // 1er du mois à 4h
    ]);

    cronScheduler.startAll();
    return cronScheduler;
}

export function shutdownCronJobs() {
    cronScheduler.stopAll();
}

export { cronScheduler };
