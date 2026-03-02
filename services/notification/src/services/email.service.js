/**
 * @module Service/Email
 *
 * Responsabilité unique : envoyer un email via Resend.
 * Aucune logique métier ici — ce service ne sait pas pourquoi il envoie,
 * seulement comment. Le "pourquoi" est géré par notification.service.js.
 *
 * En cas d'échec d'envoi, on retourne null plutôt que de lancer une exception.
 * C'est le worker qui décide de requeue le job si nécessaire.
 */
import { Resend } from 'resend';
import { ENV } from '../config/environment.js';
import { logInfo, logError } from '../utils/logger.js';

class EmailService {
    constructor() {
        if (EmailService.instance) return EmailService.instance;

        this.resend = new Resend(ENV.email.apiKey);
        this.from = `${ENV.email.fromName} <${ENV.email.fromEmail}>`;

        EmailService.instance = this;
        Object.freeze(this);
    }

    /**
     * Méthode d'envoi générique.
     * Retourne l'objet Resend en cas de succès, null en cas d'échec.
     * L'appelant (worker) gère la stratégie de retry via BullMQ.
     *
     * @param {{ to: string, subject: string, html: string }} payload
     * @returns {Promise<object|null>}
     */
    async send({ to, subject, html }) {
        try {
            const result = await this.resend.emails.send({
                from: this.from,
                to,
                subject,
                html,
            });

            logInfo(`Email envoyé — to: ${to} | sujet: ${subject}`);
            return result;
        } catch (error) {
            logError(error, { context: 'EmailService.send', to, subject });
            // On propage pour que BullMQ enregistre l'échec et relance si nécessaire
            throw error;
        }
    }
}

export const emailService = new EmailService();
