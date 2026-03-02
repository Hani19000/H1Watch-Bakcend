/**
 * @module Utils/HealthCheck
 *
 * Vérifie la disponibilité des dépendances du notification-service.
 *  - Redis : critique pour BullMQ (queue des jobs)
 *  - PostgreSQL : critique pour les logs d'audit (notification_logs)
 */
import { redisConnection } from '../config/queue.js';
import { pgPool } from '../config/database.js';

export const healthCheck = async () => {
    const checks = {};

    // Redis — critique pour BullMQ
    try {
        await redisConnection.ping();
        checks.redis = { status: 'up' };
    } catch (err) {
        checks.redis = { status: 'down', error: err.message };
    }

    // PostgreSQL — critique pour les logs d'audit
    try {
        await pgPool.query('SELECT 1');
        checks.postgres = { status: 'up' };
    } catch (err) {
        checks.postgres = { status: 'down', error: err.message };
    }

    return checks;
};
