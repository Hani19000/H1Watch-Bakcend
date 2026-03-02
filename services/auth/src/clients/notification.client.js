/**
 * @module Clients/Notification
 *
 * Client HTTP vers le notification-service.
 * Remplace l'ancien import direct vers ./notifications/notification.service.js
 * et délègue tous les envois d'email au notification-service centralisé.
 *
 * Tous les appels sont fire-and-forget par conception :
 *   - L'envoi d'email ne doit jamais faire échouer le flux métier principal
 *   - La résilience est gérée côté notification-service (BullMQ 3 retries)
 *   - On log l'erreur pour le monitoring sans bloquer l'appelant
 *
 * VARIABLES D'ENVIRONNEMENT REQUISES (déjà dans environment.js) :
 *   NOTIFICATION_SERVICE_URL       → URL publique du notification-service
 *   INTERNAL_NOTIFICATION_SECRET   → secret partagé validé par internal.middleware.js
 */
import { logError } from '../utils/logger.js';
import { ENV } from '../config/environment.js';

const BASE_URL = `${ENV.services.notificationServiceUrl}/internal/notifications`;
const TIMEOUT_MS = ENV.services.httpTimeoutMs ?? 5000;

// ── Utilitaires ────────────────────────────────────────────────────────────────

const buildHeaders = () => ({
    'Content-Type': 'application/json',
    'X-Internal-Secret': ENV.services.notificationSecret,
});

/**
 * Fetch avec timeout — évite qu'un notification-service lent
 * ne bloque le flux principal (ex : inscription, reset password).
 */
const fetchWithTimeout = async (url, options) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timeoutId);
    }
};

// ── Client ─────────────────────────────────────────────────────────────────────

export const notificationClient = {

    /**
     * Envoie une notification de manière fire-and-forget.
     * Ne lève jamais d'exception — une erreur est loggée mais ne bloque pas l'appelant.
     *
     * @param {string} type  - NOTIFICATION_TYPES (ex: 'auth.welcome')
     * @param {string} to    - Email du destinataire
     * @param {object} data  - Données métier pour le template
     */
    async enqueue(type, to, data) {
        try {
            const response = await fetchWithTimeout(`${BASE_URL}/enqueue`, {
                method: 'POST',
                headers: buildHeaders(),
                body: JSON.stringify({ type, to, data }),
            });

            if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                throw new Error(`[notificationClient.enqueue] HTTP ${response.status} — ${body?.message}`);
            }
        } catch (error) {
            // Fire-and-forget : on log sans propager pour ne pas impacter le flux principal
            logError(error, { context: 'notificationClient.enqueue', type, to });
        }
    },

    // ── Raccourcis sémantiques ────────────────────────────────────────────────
    // Évitent d'exposer NOTIFICATION_TYPES dans les services appelants

    /**
     * Email de bienvenue après inscription.
     * Appelé par auth.service.js après création du compte.
     */
    async notifyWelcome(to, userData) {
        return this.enqueue('auth.welcome', to, { userData });
    },

    /**
     * Lien de réinitialisation de mot de passe.
     * Le resetUrl est construit par passwordreset.service.js car
     * le notification-service ne connaît pas CLIENT_URL de l'auth-service.
     *
     * @param {string} to       - Email du destinataire
     * @param {string} resetUrl - URL complète avec token (ex: https://ecomwatch.fr/reset-password?token=...)
     */
    async notifyPasswordReset(to, resetUrl) {
        return this.enqueue('auth.password_reset', to, { resetUrl });
    },
};
