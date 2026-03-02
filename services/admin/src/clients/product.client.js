/**
 * @module Clients/Product
 *
 * Client HTTP vers le product-service pour les stats produit/inventaire.
 * Le product-service expose déjà GET /internal/stats — prévu pour l'admin-service
 * (documenté dans product-service/src/routes/internal.routes.js).
 */
import { ENV } from '../config/environment.js';
import { logError } from '../utils/logger.js';

const BASE_URL = `${ENV.services.productServiceUrl}/internal`;
const TIMEOUT_MS = ENV.services.httpTimeoutMs;

const buildHeaders = () => ({
    'Content-Type': 'application/json',
    'X-Internal-Secret': ENV.internal.adminSecret,
});

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
        const error = new Error(`[productClient.${context}] HTTP ${response.status}: ${body?.message || ''}`);
        error.statusCode = response.status;
        error.isOperational = true;
        throw error;
    }
    return body?.data ?? body;
};

export const productClient = {

    /**
     * Statistiques globales des produits et de l'inventaire.
     * Retourne totalProducts, lowStockCount, et les agrégats d'inventaire.
     * L'endpoint GET /internal/stats est déjà implémenté dans le product-service.
     */
    async getStats() {
        try {
            const response = await fetchWithTimeout(
                `${BASE_URL}/stats`,
                { method: 'GET', headers: buildHeaders() }
            );
            return parseResponse(response, 'getStats');
        } catch (error) {
            logError(error, { context: 'productClient.getStats' });
            throw error;
        }
    },
};
