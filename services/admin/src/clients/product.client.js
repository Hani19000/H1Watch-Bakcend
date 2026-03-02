/**
 * @module Clients/Product
 *
 * Client HTTP vers le product-service pour les stats et la gestion de l'inventaire.
 * Toutes les requêtes transitent par les routes /internal/* du product-service,
 * authentifiées via X-Internal-Secret — aucun JWT requis côté product-service.
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
        const error = new Error(
            `[productClient.${context}] HTTP ${response.status}: ${body?.message || ''}`
        );
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

    // ── Gestion de l'inventaire ───────────────────────────────────────────────
    // Ces méthodes appellent les routes /internal/admin/* du product-service,
    // protégées par INTERNAL_ADMIN_SECRET. Cela évite de valider le JWT de l'admin
    // directement dans le product-service et respecte la séparation des responsabilités.

    /**
     * Liste complète de l'inventaire avec filtres et pagination.
     * @param {{ search?, page?, limit?, sort? }} params
     */
    async getAllInventory(params = {}) {
        const qs = new URLSearchParams(
            Object.fromEntries(Object.entries(params).filter(([, v]) => v != null))
        ).toString();
        try {
            const response = await fetchWithTimeout(
                `${BASE_URL}/admin/inventory${qs ? `?${qs}` : ''}`,
                { method: 'GET', headers: buildHeaders() }
            );
            return parseResponse(response, 'getAllInventory');
        } catch (error) {
            logError(error, { context: 'productClient.getAllInventory' });
            throw error;
        }
    },

    /**
     * Articles en stock bas — permet de déclencher les réassorts avant la rupture.
     */
    async getLowStockAlerts() {
        try {
            const response = await fetchWithTimeout(
                `${BASE_URL}/admin/inventory/alerts`,
                { method: 'GET', headers: buildHeaders() }
            );
            return parseResponse(response, 'getLowStockAlerts');
        } catch (error) {
            logError(error, { context: 'productClient.getLowStockAlerts' });
            throw error;
        }
    },

    /**
     * Ajustement manuel du stock (réception, perte, correction d'inventaire).
     * @param {string} variantId
     * @param {{ quantity: number, reason?: string }} data
     */
    async adjustStock(variantId, data) {
        try {
            const response = await fetchWithTimeout(
                `${BASE_URL}/admin/inventory/${variantId}/adjust`,
                { method: 'PATCH', headers: buildHeaders(), body: JSON.stringify(data) }
            );
            return parseResponse(response, 'adjustStock');
        } catch (error) {
            logError(error, { context: 'productClient.adjustStock' });
            throw error;
        }
    },

    /**
     * Réapprovisionnement d'une variante suite à une réception de marchandise.
     * @param {string} variantId
     * @param {{ quantity: number }} data
     */
    async restockVariant(variantId, data) {
        try {
            const response = await fetchWithTimeout(
                `${BASE_URL}/admin/inventory/restock/${variantId}`,
                { method: 'PATCH', headers: buildHeaders(), body: JSON.stringify(data) }
            );
            return parseResponse(response, 'restockVariant');
        } catch (error) {
            logError(error, { context: 'productClient.restockVariant' });
            throw error;
        }
    },
};