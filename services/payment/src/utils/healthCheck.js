/**
 * @module Utils/HealthCheck
 *
 * Vérifie l'état des dépendances critiques du payment-service.
 * Exposé via GET /health pour les sondes Render, UptimeRobot, etc.
 */
import { cacheService } from '../services/cache.service.js';
import { logError } from './logger.js';

const checkPostgres = async (pgPool) => {
    try {
        await pgPool.query('SELECT 1');
        return { status: 'up' };
    } catch (error) {
        logError(error, { context: 'PostgreSQL healthcheck' });
        return { status: 'down', error: error.message };
    }
};

const checkRedis = async () => {
    try {
        await cacheService.connect();
        await cacheService.client.ping();
        return { status: 'up' };
    } catch (error) {
        logError(error, { context: 'Redis healthcheck' });
        return { status: 'down', error: error.message };
    }
};

/**
 * Agrège l'état de toutes les dépendances en parallèle pour minimiser le temps de réponse.
 */
export const healthCheck = async (pgPool) => {
    const [postgres, redis] = await Promise.all([
        checkPostgres(pgPool),
        checkRedis(),
    ]);

    return { postgres, redis };
};