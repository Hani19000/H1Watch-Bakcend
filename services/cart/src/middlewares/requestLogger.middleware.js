/**
 * @module Middlewares/RequestLogger
 *
 * Log minimal des requêtes entrantes en développement.
 * En production, Sentry gère la traçabilité via les breadcrumbs.
 */
import { ENV } from '../config/environment.js';

export const requestLogger = (req, _res, next) => {
    if (!ENV.server.isProduction) {
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
    }
    next();
};
