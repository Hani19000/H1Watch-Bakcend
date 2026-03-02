/**
 * @module Clients/Product
 *
 * Client HTTP du cart-service vers le product-service.
 *
 * Remplace les accès directs à productsRepo et inventoryRepo du monolith.
 * La validation de la variante et le contrôle de stock passent désormais
 * par les endpoints /internal du product-service, déjà documentés
 * "for cart-service" dans product-service/src/routes/internal.routes.js.
 *
 * Communication inter-services sécurisée par X-Internal-Secret.
 */
import { ENV } from '../config/environment.js';
import { logError } from '../utils/logger.js';

const BASE_URL = `${ENV.services.productServiceUrl}/internal`;
const TIMEOUT_MS = ENV.services.httpTimeoutMs;

// ── Utilitaires ────────────────────────────────────────────────────────────────

const buildHeaders = () => ({
    'Content-Type': 'application/json',
    'X-Internal-Secret': ENV.internal.productSecret,
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
        const message = body?.message || `HTTP ${response.status}`;
        const error = new Error(`[productClient.${context}] ${message}`);
        error.statusCode = response.status;
        throw error;
    }
    return body?.data ?? body;
};

// ── Client ─────────────────────────────────────────────────────────────────────

export const productClient = {

    /**
     * Valide l'existence d'une variante et récupère son prix.
     * Appelé avant chaque ajout au panier pour garantir que le produit existe.
     *
     * @returns {{ id, sku, price, attributes, productId }} | null
     */
    async findVariantById(variantId) {
        try {
            const response = await fetchWithTimeout(
                `${BASE_URL}/variants/${variantId}`,
                { method: 'GET', headers: buildHeaders() }
            );

            // 404 est un cas métier valide — on retourne null plutôt que de lever une erreur
            if (response.status === 404) return null;

            return await parseResponse(response, 'findVariantById');
        } catch (error) {
            logError(error, { context: 'productClient.findVariantById', variantId });
            throw error;
        }
    },

    /**
     * Retourne le stock disponible d'une variante en temps réel.
     * Pas de cache côté cart-service pour garantir la précision du stock.
     *
     * @returns {{ variantId, availableStock, reservedStock }} | null
     */
    async getInventory(variantId) {
        try {
            const response = await fetchWithTimeout(
                `${BASE_URL}/inventory/${variantId}`,
                { method: 'GET', headers: buildHeaders() }
            );

            if (response.status === 404) return null;

            return await parseResponse(response, 'getInventory');
        } catch (error) {
            logError(error, { context: 'productClient.getInventory', variantId });
            throw error;
        }
    },

    /**
     * Récupère variante ET stock en parallèle pour minimiser la latence.
     * Utilisé lors de l'ajout au panier — les deux informations sont toujours nécessaires.
     *
     * @returns {{ variant, inventory }}
     */
    async getVariantWithInventory(variantId) {
        const [variant, inventory] = await Promise.all([
            this.findVariantById(variantId),
            this.getInventory(variantId),
        ]);

        return { variant, inventory };
    },

    /**
     * Enrichit une liste d'articles bruts avec les données produit.
     * Utilisé par listItems pour construire la réponse complète du panier.
     * Les appels sont parallélisés pour minimiser la latence totale.
     *
     * @param {Array<{ id, cartId, variantId, quantity }>} rawItems
     * @returns {Promise<Array>} Items enrichis avec price, sku, productId, availableStock
     */
    async enrichCartItems(rawItems) {
        if (rawItems.length === 0) return [];

        const enrichmentPromises = rawItems.map(async (item) => {
            const [variant, inventory] = await Promise.allSettled([
                this.findVariantById(item.variantId),
                this.getInventory(item.variantId),
            ]);

            const variantData = variant.status === 'fulfilled' ? variant.value : null;
            const inventoryData = inventory.status === 'fulfilled' ? inventory.value : null;

            return {
                id: item.id,
                cartId: item.cartId,
                variantId: item.variantId,
                quantity: item.quantity,
                // Données produit — null si le produit a été supprimé depuis l'ajout au panier
                price: variantData ? parseFloat(variantData.price) : null,
                sku: variantData?.sku ?? null,
                attributes: variantData?.attributes ?? null,
                productId: variantData?.productId ?? null,
                availableStock: inventoryData?.availableStock ?? 0,
                // Signale au frontend que ce produit n'est plus disponible
                isUnavailable: variantData === null,
            };
        });

        return Promise.all(enrichmentPromises);
    },
};
