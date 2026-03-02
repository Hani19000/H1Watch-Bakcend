/**
 * @module Constants/Errors
 *
 * Messages d'erreur centralisés par domaine métier.
 * Centraliser ici évite les strings éparpillées dans les services.
 */
export const ERRORS = Object.freeze({
    AUTH: {
        UNAUTHORIZED: 'Authentification requise',
        TOKEN_EXPIRED: 'Session expirée, veuillez vous reconnecter',
        TOKEN_INVALID: 'Token invalide',
        TOO_MANY_ATTEMPTS: 'Trop de tentatives, veuillez réessayer plus tard',
    },
    PAYMENT: {
        ORDER_NOT_FOUND: 'Commande introuvable',
        ALREADY_PAID: 'Cette commande a déjà été payée',
        CANCELLED: 'Cette commande a été annulée',
        FORBIDDEN: 'Vous ne pouvez pas payer une commande qui ne vous appartient pas',
        STRIPE_SIGNATURE_INVALID: 'Signature webhook invalide',
        STRIPE_RAW_BODY_MISSING: 'Configuration serveur incorrecte : rawBody manquant',
    },
    SERVER: {
        INTERNAL_ERROR: 'Une erreur interne est survenue',
    },
});