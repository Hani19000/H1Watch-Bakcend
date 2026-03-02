/**
 * @module Jobs/Cron/Sessions
 *
 * Supprime les refresh tokens expirés pour limiter la croissance de la table.
 * Fréquence : tous les jours à 3h.
 */
import { pgPool } from '../config/database.js';
import { logInfo, logError } from '../utils/logger.js';

export const sessionsCleanupJob = {
    name: 'sessions-cleanup',
    schedule: '0 3 * * *',

    async execute() {
        try {
            const { rows } = await pgPool.query('SELECT cleanup_expired_tokens()');
            const count = rows[0]?.cleanup_expired_tokens || 0;

            logInfo(`[CRON:SESSIONS] ${count} token(s) supprimé(s)`);
            return { success: true, deletedCount: count };
        } catch (error) {
            logError(error, { job: 'sessions-cleanup' });
            return { success: false, error: error.message };
        }
    },
};