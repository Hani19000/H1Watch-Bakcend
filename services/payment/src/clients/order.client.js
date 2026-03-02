/**
 * @module Clients/Order
 *
 * Client HTTP du payment-service vers l'order-service.
 * Remplace les appels directs à `ordersRepo` qui existaient dans le monolith.
 *
 * Communication inter-services sécurisée par le header `X-Internal-Secret`
 * validé côté order-service par `fromMonolith` (internal.middleware.js).
 *
 * Toutes les méthodes lèvent une erreur structurée en cas d'échec
 * pour que le webhook Stripe reçoive un 500 et relance l'appel automatiquement.
 */
import { ENV } from '../config/environment.js';
import { logError } from '../utils/logger.js';

const BASE_URL = `${ENV.services.orderServiceUrl}/internal`;
const TIMEOUT_MS = ENV.services.httpTimeoutMs;

// ── Utilitaires ────────────────────────────────────────────────────────────────

const buildHeaders = () => ({
    'Content-Type': 'application/json',
    'X-Internal-Secret': ENV.internal.orderSecret,
});

/**
 * Fetch avec timeout via AbortController.
 * Évite qu'un order-service lent ne bloque indéfiniment le webhook Stripe.
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

const parseResponse = async (response, context) => {
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
        const message = body?.message || `HTTP ${response.status}`;
        const error = new Error(`[orderClient.${context}] ${message}`);
        error.statusCode = response.status;
        error.body = body;
        throw error;
    }

    return body?.data ?? body;
};

// ── Client ─────────────────────────────────────────────────────────────────────

export const orderClient = {

    /**
     * Récupère une commande avec ses items.
     * Utilisé par payment.service pour construire la session Stripe Checkout.
     */
    async findById(orderId) {
        try {
            const response = await fetchWithTimeout(
                `${BASE_URL}/orders/${orderId}`,
                { method: 'GET', headers: buildHeaders() }
            );
            return await parseResponse(response, 'findById');
        } catch (error) {
            logError(error, { context: 'orderClient.findById', orderId });
            throw error;
        }
    },

    /**
     * Marque une commande comme PAID et déclenche la confirmation de stock.
     * Appelé depuis le webhook `checkout.session.completed`.
     *
     * @param {string} orderId
     * @param {{ provider: string, paymentIntentId: string, amount: number }} paymentData
     */
    async markAsPaid(orderId, paymentData) {
        try {
            const response = await fetchWithTimeout(
                `${BASE_URL}/orders/${orderId}/status`,
                {
                    method: 'POST',
                    headers: buildHeaders(),
                    body: JSON.stringify({ status: 'PAID', paymentData }),
                }
            );
            return await parseResponse(response, 'markAsPaid');
        } catch (error) {
            logError(error, { context: 'orderClient.markAsPaid', orderId });
            throw error;
        }
    },

    /**
     * Annule une commande et libère le stock réservé.
     * Appelé depuis le webhook `checkout.session.expired`.
     *
     * @param {string} orderId
     * @param {string} reason - Motif pour les logs côté order-service
     */
    async cancelOrder(orderId, reason = 'checkout.session.expired') {
        try {
            const response = await fetchWithTimeout(
                `${BASE_URL}/orders/${orderId}/cancel`,
                {
                    method: 'POST',
                    headers: buildHeaders(),
                    body: JSON.stringify({ reason }),
                }
            );
            return await parseResponse(response, 'cancelOrder');
        } catch (error) {
            logError(error, { context: 'orderClient.cancelOrder', orderId });
            throw error;
        }
    },
};