/**
 * @module Constants/Enums
 *
 * Types de notifications supportés par le service.
 * Ce mapping est la source de vérité partagée entre :
 *  - le worker (dispatche selon le type)
 *  - le client HTTP des autres services (détermine le type à envoyer)
 *  - la validation de la route /internal/notifications/enqueue
 */
export const NOTIFICATION_TYPES = Object.freeze({
    // ── Commandes ────────────────────────────────────────────────────────────
    ORDER_CONFIRMATION:  'order.confirmation',   // Paiement validé
    ORDER_CANCELLED:     'order.cancelled',      // Session Stripe expirée ou annulation manuelle
    ORDER_SHIPPED:       'order.shipped',        // Commande expédiée
    ORDER_DELIVERED:     'order.delivered',      // Commande livrée
    ORDER_STATUS_UPDATE: 'order.status_update',  // Changement de statut générique

    // ── Authentification ─────────────────────────────────────────────────────
    AUTH_WELCOME:        'auth.welcome',         // Inscription réussie
    AUTH_PASSWORD_RESET: 'auth.password_reset',  // Demande de réinitialisation du mot de passe
});

export const QUEUE_NAMES = Object.freeze({
    NOTIFICATIONS: 'notifications',
});
