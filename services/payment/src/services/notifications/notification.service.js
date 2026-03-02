/**
 * @module Service/Notification
 *
 * Orchestre les notifications email liées aux paiements.
 * Responsabilité : décider QUAND envoyer — pas comment.
 *
 * L'email du destinataire est résolu depuis l'objet order :
 * - `session.customer_details.email` : email fourni à Stripe lors du paiement (le plus fiable)
 * - `order.shippingAddress.email`    : email de l'adresse de livraison (fallback)
 *
 * On évite intentionnellement tout appel vers l'auth-service pour récupérer l'email
 * utilisateur : le payment-service ne doit pas dépendre d'un autre service pour
 * ses notifications post-paiement, ce qui augmenterait le couplage et les points de défaillance.
 */
import { emailService } from './email.service.js';
import { logInfo, logError } from '../../utils/logger.js';

class NotificationService {
    constructor() {
        if (NotificationService.instance) return NotificationService.instance;
        NotificationService.instance = this;
        Object.freeze(this);
    }

    /**
     * Résout l'email du destinataire à partir des données disponibles.
     * Priorité à l'email Stripe (plus fiable car validé lors du paiement),
     * puis fallback sur l'adresse de livraison.
     *
     * @private
     */
    _resolveCustomerEmail(stripeSession, order) {
        return (
            stripeSession?.customer_details?.email ||
            stripeSession?.customer_email ||
            order?.shippingAddress?.email ||
            null
        );
    }

    /**
     * Envoie la confirmation de paiement au client.
     * Fire-and-forget : une erreur email ne bloque pas le flux principal.
     */
    async notifyPaymentConfirmed(stripeSession, order) {
        const email = this._resolveCustomerEmail(stripeSession, order);

        if (!email) {
            logError(
                new Error('Email introuvable pour la notification de confirmation de paiement'),
                { context: 'NotificationService.notifyPaymentConfirmed', orderId: order?.id }
            );
            return;
        }

        emailService.sendOrderConfirmation(email, order).catch((err) =>
            logError(err, { context: 'NotificationService.notifyPaymentConfirmed', orderId: order?.id })
        );

        logInfo(`Notification paiement confirmé envoyée — orderId: ${order?.id}`);
    }

    /**
     * Notifie le client que sa session a expiré sans paiement.
     * Rassure sur l'absence de débit et incite à recommander.
     */
    async notifySessionExpired(stripeSession, order) {
        const email = this._resolveCustomerEmail(stripeSession, order);

        if (!email) {
            // L'absence d'email sur une session expirée n'est pas critique — on log et on continue.
            logInfo(`Session expirée sans email résolvable — orderId: ${order?.id}`);
            return;
        }

        emailService.sendOrderCancelled(email, order).catch((err) =>
            logError(err, { context: 'NotificationService.notifySessionExpired', orderId: order?.id })
        );

        logInfo(`Notification session expirée envoyée — orderId: ${order?.id}`);
    }
}

export const notificationService = new NotificationService();