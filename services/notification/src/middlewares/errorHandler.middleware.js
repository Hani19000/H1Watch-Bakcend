/**
 * @module Middleware/ErrorHandler
 *
 * Gestionnaire d'erreurs global Express.
 * Doit être enregistré en dernier dans app.js, après toutes les routes.
 */
import { AppError } from '../utils/appError.js';
import { ENV } from '../config/environment.js';
import { logError } from '../utils/logger.js';

const sendErrorDev = (err, res) => {
    res.status(err.statusCode).json({
        status: err.status,
        error: err,
        message: err.message,
        stack: err.stack,
    });
};

const sendErrorProd = (err, res) => {
    if (err.isOperational) {
        res.status(err.statusCode).json({
            status: err.status,
            message: err.message,
        });
    } else {
        logError(err, { context: 'Unhandled error' });
        res.status(500).json({
            status: 'error',
            message: 'Une erreur interne est survenue.',
        });
    }
};

// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, _req, res, _next) => {
    err.statusCode = err.statusCode || 500;
    err.status = err.status || 'error';

    if (ENV.server.nodeEnv === 'development') {
        sendErrorDev(err, res);
    } else {
        let error = Object.assign(Object.create(Object.getPrototypeOf(err)), err);
        error.message = err.message;

        if (error.name === 'JsonWebTokenError') {
            error = new AppError('Token invalide.', 401);
        }
        if (error.name === 'TokenExpiredError') {
            error = new AppError('Token expiré.', 401);
        }

        sendErrorProd(error, res);
    }
};
