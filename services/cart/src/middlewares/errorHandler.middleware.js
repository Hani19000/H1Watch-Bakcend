/**
 * @module Middlewares/ErrorHandler
 *
 * Gestionnaire d'erreurs global Express (4 paramètres).
 * Distingue les erreurs opérationnelles (AppError.isOperational)
 * des bugs imprévus pour ne pas exposer les détails en production.
 */
import * as Sentry from '@sentry/node';
import { logError } from '../utils/logger.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';

const handlePostgresError = (err) => {
    if (err.code === '23505') {
        return { statusCode: HTTP_STATUS.CONFLICT, message: 'Entrée déjà existante' };
    }
    if (err.code === '22P02') {
        return { statusCode: HTTP_STATUS.BAD_REQUEST, message: 'Format UUID invalide' };
    }
    return null;
};

export const errorHandler = (err, req, res, _next) => {
    // Transformation des erreurs PostgreSQL en erreurs lisibles
    const pgError = handlePostgresError(err);
    if (pgError) {
        return res.status(pgError.statusCode).json({
            status: 'fail',
            message: pgError.message,
        });
    }

    const statusCode = err.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR;
    const isOperational = err.isOperational === true;

    // Erreurs inattendues → Sentry (ne pas exposer les détails en production)
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
