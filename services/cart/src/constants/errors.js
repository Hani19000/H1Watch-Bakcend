/**
 * @module Constants/Errors
 *
 * Messages d'erreur centralisés par domaine métier.
 */
export const ERRORS = Object.freeze({
    AUTH: {
        UNAUTHORIZED: 'Authentification requise',
        TOKEN_EXPIRED: 'Session expirée, veuillez vous reconnecter',
        TOKEN_INVALID: 'Token invalide',
    },
    CART: {
        NOT_FOUND: 'Panier introuvable',
        ITEM_NOT_FOUND: "Cet article n'existe pas dans votre panier",
        VARIANT_NOT_FOUND: 'Produit introuvable',
        INSUFFICIENT_STOCK: 'Stock insuffisant',
    },
    SERVER: {
        INTERNAL_ERROR: 'Une erreur interne est survenue',
    },
});
