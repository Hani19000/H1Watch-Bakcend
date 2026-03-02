/**
 * @module Middleware/RequestLogger
 *
 * Journalise chaque requête HTTP avec sa durée et son statut.
 * Désactivé en mode test pour ne pas polluer les sorties vitest.
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

        let statusColor = '\x1b[32m';
        if (status >= 400) statusColor = '\x1b[33m';
        if (status >= 500) statusColor = '\x1b[31m';
        const reset = '\x1b[0m';

        logInfo(`${method} ${originalUrl} ${statusColor}${status}${reset} - ${duration}ms`);
    });

    next();
};
