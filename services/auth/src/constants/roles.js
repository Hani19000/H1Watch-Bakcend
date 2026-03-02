/**
 * @module Config/Roles
 *
 * Définition des rôles applicatifs et de leurs permissions associées.
 * Centraliser ici permet de modifier les accès sans toucher aux middlewares.
 */

/** Identifiants de rôles tels qu'ils sont stockés en base / dans le JWT */
export const ROLES = Object.freeze({
    ADMIN: 'admin',
    USER: 'user',
    VISITOR: 'visitor',
});

/**
 * Matrice de permissions par rôle.
 * Toute nouvelle permission doit être ajoutée ici en premier
 * avant d'être vérifiée dans les middlewares.
 */
export const PERMISSIONS = Object.freeze({
    [ROLES.ADMIN]: [
        'VIEW_PRODUCTS', 'CREATE_PRODUCT', 'UPDATE_PRODUCT',
        'DELETE_PRODUCT', 'MANAGE_USERS',
    ],
    [ROLES.USER]: [
        'VIEW_PRODUCTS', 'BUY_PRODUCT', 'WISHLIST_PRODUCT', 'MANAGE_CART',
    ],
    [ROLES.VISITOR]: [
        'VIEW_PRODUCTS', 'CREATE_ACCOUNT', 'BUY_PRODUCT',
    ],
});