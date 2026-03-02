/**
 * @module Utils/HealthCheck
 *
 * Vérifie la disponibilité des services aval critiques pour l'admin-service.
 *
 * L'admin-service n'ayant pas de base de données propre, le health check
 * teste la joignabilité des services dont il dépend via leurs endpoints /health.
 * Un service indisponible est signalé en "degraded" mais ne bloque pas le démarrage.
 */
import { ENV } from '../config/environment.js';
import { logError } from './logger.js';

/**
 * Sonde le /health d'un service distant avec un timeout court.
 * Retourne un statut dégradé sans lancer d'exception en cas d'erreur réseau.
 */
const checkService = async (name, url) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    try {
        const response = await fetch(`${url}/health`, { signal: controller.signal });
        return response.ok
            ? { status: 'up' }
            : { status: 'degraded', code: response.status };
    } catch (error) {
        logError(error, { context: `healthCheck — ${name}` });
        return { status: 'down', error: error.message };
    } finally {
        clearTimeout(timeoutId);
    }
};

/**
 * Agrège l'état des services en parallèle pour minimiser le temps de réponse.
 */
export const healthCheck = async () => {
    const [auth, order, product] = await Promise.all([
        checkService('auth-service',    ENV.services.authServiceUrl),
        checkService('order-service',   ENV.services.orderServiceUrl),
        checkService('product-service', ENV.services.productServiceUrl),
    ]);

    return { auth, order, product };
};
