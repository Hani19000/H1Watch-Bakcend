/**
 * @module Utils/AppError
 *
 * Classes d'erreurs personnalisées pour une gestion cohérente des cas d'échec.
 * Étendre AppError plutôt que Error natif permet au gestionnaire central
 * de distinguer les erreurs opérationnelles des bugs imprévus.
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

/** Ressource absente en base de données (404) */
export class NotFoundError extends AppError {
    constructor(resource = 'Resource', id = '') {
        super(`${resource} ${id ? `with ID "${id}" ` : ''}not found`, 404);
    }
}

/** Données entrantes invalides ou incomplètes (400) */
export class ValidationError extends AppError {
    constructor(message) {
        super(message, 400);
    }
}

/** Règle métier non respectée (422) */
export class BusinessError extends AppError {
    constructor(message) {
        super(message, 422);
    }
}