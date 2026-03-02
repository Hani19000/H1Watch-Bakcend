/**
 * @module Utils/AppError
 *
 * Classes d'erreurs personnalisées.
 * isOperational permet au gestionnaire global de distinguer les erreurs métier
 * (attendues) des bugs imprévus capturés par Sentry.
 */
export class AppError extends Error {
    constructor(message, statusCode = 500) {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = statusCode;
        this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
        this.isOperational = true;
        Error.captureStackTrace(this, this.constructor);
    }
}

export class NotFoundError extends AppError {
    constructor(resource = 'Resource') {
        super(`${resource} introuvable`, 404);
    }
}

export class ValidationError extends AppError {
    constructor(message) {
        super(message, 400);
    }
}
