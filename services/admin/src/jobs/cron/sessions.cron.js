/**
 * @module Jobs/Cron/Sessions
 *
 * Supprime les refresh tokens expirés pour limiter la croissance de la table.
 * Fréquence : tous les jours à 3h.
 *
 * Délègue à l'auth-service propriétaire du schéma "auth".
 */
import { authClient } from '../../clients/auth.client.js';
import { logInfo, logError } from '../../utils/logger.js';

export const sessionsCleanupJob = {
    name: 'sessions-cleanup',
    schedule: '0 3 * * *',

    async execute() {
        try {
            const result = await authClient.triggerSessionsCleanup();
            logInfo(`[CRON:SESSIONS] ${result?.deletedCount ?? 0} token(s) supprimé(s)`);
            return { success: true, ...result };
        } catch (error) {
            logError(error, { job: 'sessions-cleanup' });
            return { success: false, error: error.message };
        }
    },
};
