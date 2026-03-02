/**
 * @module Utils/AppError
 *
 * Classes d'erreurs personnalisées pour une gestion cohérente des cas d'échec.
 * isOperational permet au gestionnaire global de distinguer les erreurs métier
 * des bugs imprévus (qui sont capturés par Sentry).
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

export class BusinessError extends AppError {
    constructor(message) {
        super(message, 422);
    }
}

/**
 * Guard : lève une NotFoundError si la ressource est null ou undefined.
 * Évite les vérifications répétitives dans les services.
 */
export const assertExists = (resource, name, id) => {
    if (!resource) throw new NotFoundError(name, id);
    return resource;
};
