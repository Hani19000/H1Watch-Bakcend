/**
 * @module Middlewares/ErrorHandler
 *
 * Gestionnaire d'erreurs global Express (4 paramètres).
 * Distingue les erreurs opérationnelles des bugs imprévus capturés par Sentry.
 */
import * as Sentry from '@sentry/node';
import { logError } from '../utils/logger.js';

export const errorHandler = (err, req, res, _next) => {
    const statusCode = err.statusCode || 500;
    const isOperational = err.isOperational === true;

    if (!isOperational) {
        Sentry.captureException(err);
        logError(err, { url: req.originalUrl, method: req.method });
    }

    if (process.env.NODE_ENV === 'development') {
        return res.status(statusCode).json({
            status: err.status || 'error',
            message: err.message,
            stack: err.stack,
        });
    }

    res.status(statusCode).json({
        status: err.status || 'error',
        message: isOperational ? err.message : 'Une erreur interne est survenue',
    });
};
