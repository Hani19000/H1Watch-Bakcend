/**
 * @module Utils/AppError
 *
 * Classes d'erreurs personnalisées pour une gestion cohérente des cas d'échec.
 * Étendre AppError plutôt que Error natif permet au gestionnaire d'erreurs central
 * de distinguer les erreurs opérationnelles (attendues) des bugs imprévus.
 */

/**
 * Classe de base pour toutes les erreurs métier de l'application.
 * `isOperational: true` signale que l'erreur est connue et gérée,
 * contrairement à un crash inattendu.
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

/** Tentative de création d'une ressource déjà existante, ex: email dupliqué (409) */
export class ConflictError extends AppError {
    constructor(message) {
        super(message, 409);
    }
}

/** Règle métier non respectée, ex: stock insuffisant (422) */
export class BusinessError extends AppError {
    constructor(message) {
        super(message, 422);
    }
}

/**
 * Guard utilitaire : lance NotFoundError si la ressource est absente.
 * Permet d'écrire `assertExists(product, 'Product', id)` plutôt qu'un if/throw répété.
 */
export const assertExists = (resource, resourceName, id) => {
    if (!resource) {
        throw new NotFoundError(resourceName, id);
    }
    return resource;
};