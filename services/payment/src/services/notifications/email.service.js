/**
 * @module Service/Email
 *
 * Service d'envoi d'emails transactionnels via Resend.
 * Isolé pour permettre le changement de provider sans impacter payment.service.
 *
 * L'envoi d'email est toujours fire-and-forget : une erreur email
 * ne doit jamais faire échouer le flux de paiement principal.
 */
import { Resend } from 'resend';
import { ENV } from '../../config/environment.js';
import { logInfo, logError } from '../../utils/logger.js';
import { emailTemplates } from '../templates/email/index.js';

class EmailService {
    constructor() {
        if (EmailService.instance) return EmailService.instance;

        this.resend = new Resend(ENV.email.apiKey);
        this.fromEmail = ENV.email.fromEmail;
        this.fromName = ENV.email.fromName;

        EmailService.instance = this;
        Object.freeze(this);
    }

    /**
     * Méthode générique d'envoi avec gestion d'erreur centralisée.
     * Retourne null en cas d'échec pour ne pas bloquer l'appelant.
     *
     * @private
     */
    async _sendEmail({ to, subject, html }) {
        try {
            const result = await this.resend.emails.send({
                from: `${this.fromName} <${this.fromEmail}>`,
                to,
                subject,
                html,
            });

            logInfo(`Email envoyé à ${to} — sujet : ${subject}`);
            return result;
        } catch (error) {
            logError(error, { context: 'EmailService._sendEmail', to, subject });
            return null;
        }
    }

    /**
     * Confirmation de paiement.
     * Envoyé après le webhook `checkout.session.completed`.
     */
    async sendOrderConfirmation(to, orderData) {
        const { subject, html } = emailTemplates.orderConfirmation(orderData);
        return this._sendEmail({ to, subject, html });
    }

    /**
     * Notification d'annulation suite à une session expirée.
     * Envoyé après le webhook `checkout.session.expired`.
     */
    async sendOrderCancelled(to, orderData) {
        const { subject, html } = emailTemplates.orderCancelled(orderData);
        return this._sendEmail({ to, subject, html });
    }
}

export const emailService = new EmailService();