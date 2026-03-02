/**
 * @module Utils/AppError
 *
 * Classes d'erreurs personnalisées pour une gestion cohérente des cas d'échec.
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
    constructor(resource = 'Resource', id = '') {
        super(`${resource} ${id ? `with ID "${id}" ` : ''}not found`, 404);
    }
}

export class ValidationError extends AppError {
    constructor(message) {
        super(message, 400);
    }
}
