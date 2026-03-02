/**
 * @module Clients/Notification
 *
 * Client HTTP vers le notification-service.
 * À ajouter dans les services auth, order, payment et cart
 * pour remplacer les appels directs à emailService/notificationService locaux.
 *
 * Tous les appels sont fire-and-forget par conception :
 *   - L'envoi d'email ne doit jamais faire échouer le flux métier principal
 *   - La résilience est gérée côté notification-service (BullMQ retry)
 *   - On log l'erreur pour le monitoring sans bloquer l'appelant
 *
 * VARIABLES D'ENVIRONNEMENT À AJOUTER dans le service hôte :
 *   NOTIFICATION_SERVICE_URL       → ex: https://notification-service.onrender.com
 *   INTERNAL_NOTIFICATION_SECRET   → secret partagé avec notification-service
 */
import { logError } from '../utils/logger.js';
import { ENV } from '../config/environment.js';

const BASE_URL = `${ENV.services.notificationServiceUrl}/internal/notifications`;
const TIMEOUT_MS = ENV.services.httpTimeoutMs ?? 5000;

// ── Utilitaires ────────────────────────────────────────────────────────────────

const buildHeaders = () => ({
    'Content-Type': 'application/json',
    'X-Internal-Secret': ENV.internal.notificationSecret,
});

/**
 * Fetch avec timeout — évite qu'un notification-service lent ne bloque
 * le flux principal (ex: webhook Stripe).
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
     * @param {string} type  - NOTIFICATION_TYPES (ex: 'order.confirmation')
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

    async notifyOrderConfirmation(to, orderData) {
        return this.enqueue('order.confirmation', to, { orderData });
    },

    async notifyOrderCancelled(to, orderData, reason = null) {
        return this.enqueue('order.cancelled', to, { orderData, reason });
    },

    async notifyOrderShipped(to, orderData, shipmentData = {}) {
        return this.enqueue('order.shipped', to, { orderData, shipmentData });
    },

    async notifyOrderDelivered(to, orderData) {
        return this.enqueue('order.delivered', to, { orderData });
    },

    async notifyWelcome(to, userData) {
        return this.enqueue('auth.welcome', to, { userData });
    },

    async notifyPasswordReset(to, resetUrl) {
        return this.enqueue('auth.password_reset', to, { resetUrl });
    },
};
