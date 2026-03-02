/**
 * @module Middleware/Logger
 *
 * Journalise chaque requête HTTP avec sa durée et son statut.
 * L'événement 'finish' garantit une mesure du temps de traitement réel côté serveur.
 */
import { ENV } from '../config/environment.js';
import { logInfo } from '../utils/logger.js';

export const requestLogger = (req, res, next) => {
    if (ENV.server.nodeEnv === 'test') return next();

    const start = Date.now();
    const { method, originalUrl } = req;

    res.on('finish', () => {
        const duration = Date.now() - start;
        const status = res.statusCode;

        // Codes couleur ANSI : vert (2xx), jaune (4xx), rouge (5xx)
        let color = '\x1b[32m';
        if (status >= 400) color = '\x1b[33m';
        if (status >= 500) color = '\x1b[31m';
        const reset = '\x1b[0m';

        logInfo(`${method} ${originalUrl} ${color}${status}${reset} - ${duration}ms`);
    });

    next();
};
