/**
 * @module Constants/Enums
 *
 * Source unique de vérité pour les valeurs ENUM du payment-service.
 * Alignées avec les enums PostgreSQL des schémas "payment" et "order".
 */

/** Correspond à payment_status_enum dans payment.payments */
export const PAYMENT_STATUS = Object.freeze({
    PENDING: 'PENDING',
    SUCCESS: 'SUCCESS',
    FAILED: 'FAILED',
});

/**
 * Statuts de commande utilisés pour valider l'état d'une commande
 * avant de créer une session Stripe.
 * Correspond à order_status_enum dans order.orders.
 */
export const ORDER_STATUS = Object.freeze({
    PENDING: 'PENDING',
    PAID: 'PAID',
    PROCESSING: 'PROCESSING',
    SHIPPED: 'SHIPPED',
    DELIVERED: 'DELIVERED',
    CANCELLED: 'CANCELLED',
    REFUNDED: 'REFUNDED',
});