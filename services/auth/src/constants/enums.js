/**
 * @module Constants/Enums
 *
 * Source unique de vérité pour les valeurs ENUM de PostgreSQL.
 * Centraliser ici évite les strings en dur dans les services/contrôleurs
 * et garantit la cohérence avec les contraintes DB.
 */

/** Correspond à user_role_enum en base */
export const USER_ROLES = Object.freeze({
    USER: 'USER',
    ADMIN: 'ADMIN',
});

/** Correspond à order_status_enum en base */
export const ORDER_STATUS = Object.freeze({
    PENDING: 'PENDING',
    PAID: 'PAID',
    PROCESSING: 'PROCESSING',
    SHIPPED: 'SHIPPED',
    DELIVERED: 'DELIVERED',
    CANCELLED: 'CANCELLED',
    REFUNDED: 'REFUNDED',
});

/** Correspond à payment_status_enum en base */
export const PAYMENT_STATUS = Object.freeze({
    PENDING: 'PENDING',
    SUCCESS: 'SUCCESS',
    FAILED: 'FAILED',
});

/** Correspond à product_status_enum en base */
export const PRODUCT_STATUS = Object.freeze({
    DRAFT: 'DRAFT',
    ACTIVE: 'ACTIVE',
    ARCHIVED: 'ARCHIVED',
});

export const USER_STATUS = {
    ACTIVE: 'ACTIVE',
    BLOCKED: 'BLOCKED'
};

/**
 * Vérifie si une valeur appartient à un enum donné.
 * Préférer cette fonction à un switch/case pour rester DRY.
 */
export const isValidEnum = (value, enumObj) => {
    return Object.values(enumObj).includes(value);
};

/**
 * Lance une erreur explicite si la valeur n'est pas dans l'enum.
 * Utilisé en entrée de service pour échouer tôt (fail-fast).
 */
export const validateEnum = (value, enumObj, fieldName) => {
    if (!isValidEnum(value, enumObj)) {
        throw new Error(
            `Invalid ${fieldName}: "${value}". Must be one of: ${Object.values(enumObj).join(', ')}`
        );
    }
};