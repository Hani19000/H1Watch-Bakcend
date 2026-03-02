/**
 * @module Utils/HealthCheck
 *
 * Vérifie l'état des dépendances critiques de l'order-service.
 * Exposé via GET /health pour les sondes Render, UptimeRobot, etc.
 *
 * Retourner un objet structuré plutôt que de throw permet d'agréger
 * l'état de toutes les dépendances sans court-circuiter les autres vérifications.
 */
import { cacheService } from '../services/cache.service.js';
import { logError } from './logger.js';

/**
 * Sonde la connexion PostgreSQL avec une requête légère.
 */
const checkPostgres = async (pgPool) => {
    try {
        await pgPool.query('SELECT 1');
        return { status: 'up' };
    } catch (error) {
        logError(error, { context: 'PostgreSQL healthcheck' });
        return { status: 'down', error: error.message };
    }
};

/**
 * Sonde la connexion Redis (Upstash) avec un PING.
 */
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
 * Agrège l'état de toutes les dépendances en parallèle.
 * Les vérifications sont lancées simultanément pour minimiser le temps de réponse.
 *
 * @param {import('pg').Pool} pgPool
 * @returns {Promise<{ postgres: object, redis: object }>}
 */
export const healthCheck = async (pgPool) => {
    const [postgres, redis] = await Promise.all([
        checkPostgres(pgPool),
        checkRedis(),
    ]);

    return { postgres, redis };
};