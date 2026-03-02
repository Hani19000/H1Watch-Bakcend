/**
 * @module Utils/HealthCheck
 *
 * Vérifie l'état des dépendances critiques de l'admin-service.
 * Exposé via GET /health pour les sondes Render.
 *
 * Redis est non-bloquant : son indisponibilité est signalée sans faire échouer
 * le health check global (l'admin-service continue de fonctionner sans cache).
 */
import { cacheService } from '../services/cache.service.js';

const checkRedis = () => {
    // isReady() reflète l'état de connexion sans déclencher de requête réseau.
    return cacheService.isReady()
        ? { status: 'up' }
        : { status: 'degraded', message: 'Redis non connecté — cache désactivé' };
};

/**
 * Agrège l'état des dépendances.
 * L'admin-service est stateless (pas de DB directe) — seul Redis est vérifié.
 */
export const healthCheck = () => {
    return { redis: checkRedis() };
};
