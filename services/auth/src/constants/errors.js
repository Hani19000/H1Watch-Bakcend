/**
 * @module Constants/Errors
 *
 * Messages d'erreur centralisés par domaine métier.
 * Regrouper ici évite les strings éparpillées et facilite les traductions futures.
 */
export const ERRORS = Object.freeze({
    AUTH: {
        UNAUTHORIZED: 'Authentification requise',
        INVALID_CREDENTIALS: 'Identifiants invalides',
        TOKEN_EXPIRED: 'Session expirée, veuillez vous reconnecter',
        TOKEN_INVALID: 'Token invalide',
        FORBIDDEN: 'Accès refusé',
        TOO_MANY_ATTEMPTS: 'Trop de tentatives, veuillez réessayer plus tard',
    },
    VALIDATION: {
        REQUIRED_FIELD: 'Champ requis manquant',
        INVALID_FORMAT: 'Format invalide',
        PASSWORD_TOO_WEAK: 'Mot de passe trop faible',
        EMAIL_ALREADY_EXISTS: 'Cette adresse email est déjà utilisée',
        INVALID_ID: 'Identifiant invalide',
    },
    DB: {
        NOT_FOUND: 'Ressource introuvable',
        DUPLICATE_ENTRY: 'Entrée déjà existante',
        CONSTRAINT_VIOLATION: 'Violation de contrainte',
        CONNECTION_FAILED: 'Erreur de connexion à la base de données',
    },
    SERVER: {
        INTERNAL_ERROR: 'Erreur interne du serveur',
        SERVICE_UNAVAILABLE: 'Service temporairement indisponible',
    },
});