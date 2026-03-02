/**
 * @module Constants/HttpStatus
 *
 * Codes HTTP nommés pour éviter les magic numbers dans les contrôleurs.
 * Frozen pour prévenir toute mutation accidentelle au runtime.
 */
export const HTTP_STATUS = Object.freeze({
    // 2xx – Succès
    OK: 200,
    CREATED: 201,
    ACCEPTED: 202,
    NO_CONTENT: 204,

    // 4xx – Erreur client
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    UNPROCESSABLE_ENTITY: 422,
    TOO_MANY_REQUESTS: 429,

    // 5xx – Erreur serveur
    INTERNAL_SERVER_ERROR: 500,
    NOT_IMPLEMENTED: 501,
    BAD_GATEWAY: 502,
    SERVICE_UNAVAILABLE: 503,
});