/**
 * @module Middleware/Logger
 *
 * Log structuré de chaque requête HTTP entrante.
 * Utile pour le débogage et la traçabilité en production.
 */
import { logInfo } from '../utils/logger.js';

export const requestLogger = (req, _res, next) => {
    logInfo(`${req.method} ${req.originalUrl}`);
    next();
};
