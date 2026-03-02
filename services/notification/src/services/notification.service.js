/**
 * @module Service/Notification
 *
 * Orchestre la construction du payload email à partir du type de notification
 * et des données métier reçues.
 *
 * Responsabilité : choisir le bon template selon le type, résoudre l'email
 * du destinataire, puis déléguer l'envoi à emailService.
 *
 * Ce service est appelé exclusivement par le worker BullMQ.
 * Il ne connaît pas BullMQ — il ne reçoit que les données brutes du job.
 */
import { emailService } from './email.service.js';
import { emailTemplates } from '../templates/email/index.js';
import { NOTIFICATION_TYPES } from '../constants/enums.js';
import { ENV } from '../config/environment.js';
import { logInfo, logError } from '../utils/logger.js';

class NotificationService {
    constructor() {
        if (NotificationService.instance) return NotificationService.instance;
        NotificationService.instance = this;
        Object.freeze(this);
    }

    /**
     * Point d'entrée principal du service.
     * Dispatche vers le handler approprié selon le type de notification.
     *
     * @param {{ type: string, to: string, data: object }} job - Données brutes du job BullMQ
     * @throws {Error} Si le type de notification est inconnu ou si l'envoi échoue
     */
    async process({ type, to, data }) {
        logInfo(`Traitement notification — type: ${type} | to: ${to}`);

        switch (type) {
            case NOTIFICATION_TYPES.ORDER_CONFIRMATION:
                return this._sendOrderConfirmation(to, data);

            case NOTIFICATION_TYPES.ORDER_CANCELLED:
                return this._sendOrderCancelled(to, data);

            case NOTIFICATION_TYPES.ORDER_SHIPPED:
                return this._sendOrderShipped(to, data);

            case NOTIFICATION_TYPES.ORDER_DELIVERED:
                return this._sendOrderDelivered(to, data);

            case NOTIFICATION_TYPES.ORDER_STATUS_UPDATE:
                return this._routeOrderStatusUpdate(to, data);

            case NOTIFICATION_TYPES.AUTH_WELCOME:
                return this._sendAuthWelcome(to, data);

            case NOTIFICATION_TYPES.AUTH_PASSWORD_RESET:
                return this._sendAuthPasswordReset(to, data);

            default:
                // Un type inconnu est une erreur de configuration côté appelant,
                // pas un problème réseau — on ne requeue pas.
                logError(new Error(`Type de notification inconnu : ${type}`), { type, to });
                throw new Error(`Type de notification inconnu : ${type}`);
        }
    }

    // ── Handlers privés ───────────────────────────────────────────────────────

    async _sendOrderConfirmation(to, { orderData }) {
        const { subject, html } = emailTemplates.orderConfirmation(orderData, ENV.clientUrl);
        return emailService.send({ to, subject, html });
    }

    async _sendOrderCancelled(to, { orderData, reason }) {
        const { subject, html } = emailTemplates.orderCancelled(orderData, ENV.clientUrl, reason);
        return emailService.send({ to, subject, html });
    }

    async _sendOrderShipped(to, { orderData, shipmentData }) {
        const { subject, html } = emailTemplates.orderShipped(orderData, shipmentData ?? {}, ENV.clientUrl);
        return emailService.send({ to, subject, html });
    }

    async _sendOrderDelivered(to, { orderData }) {
        const { subject, html } = emailTemplates.orderDelivered(orderData, ENV.clientUrl);
        return emailService.send({ to, subject, html });
    }

    /**
     * Route les changements de statut génériques vers le handler spécifique
     * si possible, sinon laisse l'appelant envoyer le type exact directement.
     * Conservé pour la compatibilité avec les services qui utilisent encore
     * notifyOrderStatusChange() côté monolith.
     */
    async _routeOrderStatusUpdate(to, { orderData, newStatus, additionalData }) {
        switch (newStatus) {
            case 'PAID':
                return this._sendOrderConfirmation(to, { orderData });
            case 'SHIPPED':
                return this._sendOrderShipped(to, { orderData, shipmentData: additionalData?.shipment });
            case 'DELIVERED':
                return this._sendOrderDelivered(to, { orderData });
            case 'CANCELLED':
                return this._sendOrderCancelled(to, { orderData, reason: additionalData?.cancellationReason });
            default:
                // Statut non mappé — on log et on acquitte sans email
                logInfo(`Statut ${newStatus} non mappé à un template — notification ignorée`);
        }
    }

    async _sendAuthWelcome(to, { userData }) {
        const { subject, html } = emailTemplates.authWelcome(userData, ENV.clientUrl);
        return emailService.send({ to, subject, html });
    }

    async _sendAuthPasswordReset(to, { resetUrl }) {
        const { subject, html } = emailTemplates.authPasswordReset(resetUrl);
        return emailService.send({ to, subject, html });
    }
}

export const notificationService = new NotificationService();
