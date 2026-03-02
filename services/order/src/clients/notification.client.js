/**
 * @module Clients/Notification
 *
 * Client HTTP vers le notification-service centralisé.
 * Remplace l'ancien import direct vers ./notifications/notification.service.js
 * et délègue tous les envois d'email au notification-service via BullMQ.
 *
 * Tous les appels sont fire-and-forget par conception :
 *   - L'envoi d'email ne doit jamais faire échouer le flux métier principal
 *   - La résilience (retries) est gérée côté notification-service (BullMQ × 3)
 *   - On log l'erreur pour le monitoring sans bloquer l'appelant
 *
 * VARIABLES D'ENVIRONNEMENT REQUISES (à ajouter dans environment.js) :
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
    'X-Internal-Secret': ENV.internal.notificationSecret,
});

/**
 * Fetch avec timeout — évite qu'un notification-service lent
 * ne bloque le flux principal (ex : changement de statut commande).
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
     * @param {string} type  - Type de notification (ex: 'order.shipped')
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
    // Évitent d'exposer les types de notification bruts dans les services appelants

    /**
     * Commande expédiée.
     * @param {string} to            - Email du destinataire
     * @param {object} orderData     - Données de la commande
     * @param {object} shipmentData  - Données d'expédition (numéro de suivi, etc.)
     */
    async notifyOrderShipped(to, orderData, shipmentData = {}) {
        return this.enqueue('order.shipped', to, { orderData, shipmentData });
    },

    /**
     * Commande livrée.
     * @param {string} to        - Email du destinataire
     * @param {object} orderData - Données de la commande
     */
    async notifyOrderDelivered(to, orderData) {
        return this.enqueue('order.delivered', to, { orderData });
    },

    /**
     * Commande annulée (annulation manuelle ou expiration de session).
     * @param {string}      to        - Email du destinataire
     * @param {object}      orderData - Données de la commande
     * @param {string|null} reason    - Motif d'annulation (optionnel)
     */
    async notifyOrderCancelled(to, orderData, reason = null) {
        return this.enqueue('order.cancelled', to, { orderData, reason });
    },
};
