/**
 * @module Clients/Product
 *
 * Client HTTP de l'order-service vers le product-service.
 * Remplace les appels directs à `productsRepo` dans orders.service.js.
 *
 * Données retournées par le product-service :
 * - `getVariant`        → { id, price, weight, sku, productId, attributes }
 * - `getPromotionPrice` → { basePrice, effectivePrice, hasPromotion }
 */
import { ENV } from '../config/environment.js';
import { logError } from '../utils/logger.js';

// product-service expose ses variants sous /internal/variants
// (chemin distinct de l'ancien /internal/products pour plus de clarté)
const BASE_URL = `${ENV.services.productServiceUrl}/internal/variants`;
const TIMEOUT_MS = ENV.services.httpTimeoutMs;

// ── Utilitaires ───────────────────────────────────────────────────────────────

const buildHeaders = () => ({
    'Content-Type': 'application/json',
    // Secret partagé avec le product-service (INTERNAL_PRODUCT_SECRET)
    'X-Internal-Secret': ENV.internal.productSecret,
});

const fetchWithTimeout = async (url, options) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        return response;
    } finally {
        clearTimeout(timeoutId);
    }
};

const parseResponse = async (response, context) => {
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
        const message = body?.message || `HTTP ${response.status}`;
        const error = new Error(`[productClient.${context}] ${message}`);
        error.statusCode = response.status;
        error.body = body;
        throw error;
    }

    return body?.data ?? body;
};

// ── Client ────────────────────────────────────────────────────────────────────

export const productClient = {

    /**
     * Récupère les données d'une variante produit (prix de base, poids, slug).
     * Utilisé dans `previewOrderTotal` pour obtenir le poids sans réserver le stock.
     *
     * @param {string} variantId - UUID de la variante
     * @throws {Error} Si la variante est introuvable (404) ou le monolith inaccessible
     */
    async getVariant(variantId) {
        try {
            const response = await fetchWithTimeout(
                `${BASE_URL}/variant/${variantId}`,
                { method: 'GET', headers: buildHeaders() }
            );

            return await parseResponse(response, 'getVariant');
        } catch (error) {
            logError(error, { context: 'productClient.getVariant', variantId });
            throw error;
        }
    },

    /**
     * Récupère le prix effectif d'une variante en tenant compte des promotions actives.
     * Retourne le prix de base si aucune promotion n'est active.
     *
     * @param {string} variantId - UUID de la variante
     * @returns {{ basePrice: number, effectivePrice: number, hasPromotion: boolean }}
     * @throws {Error} Si le monolith est inaccessible
     */
    async getPromotionPrice(variantId) {
        try {
            const response = await fetchWithTimeout(
                `${BASE_URL}/variant/${variantId}/promo`,
                { method: 'GET', headers: buildHeaders() }
            );

            return await parseResponse(response, 'getPromotionPrice');
        } catch (error) {
            logError(error, { context: 'productClient.getPromotionPrice', variantId });
            throw error;
        }
    },
};