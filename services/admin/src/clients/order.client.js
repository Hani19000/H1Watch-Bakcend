/**
 * @module Clients/Order
 *
 * Client HTTP vers l'order-service pour les stats de vente et les crons.
 * L'order-service est propriétaire du schéma "order" — toute lecture ou
 * opération sur les commandes passe par lui.
 */
import { ENV } from '../config/environment.js';
import { logError } from '../utils/logger.js';

const BASE_URL = `${ENV.services.orderServiceUrl}/internal/admin`;
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
        const error = new Error(`[orderClient.${context}] HTTP ${response.status}: ${body?.message || ''}`);
        error.statusCode = response.status;
        error.isOperational = true;
        throw error;
    }
    return body?.data ?? body;
};

export const orderClient = {

    /**
     * Statistiques globales des commandes : count, totalAmount.
     * Exclut les commandes CANCELLED.
     */
    async getGlobalStats() {
        try {
            const response = await fetchWithTimeout(
                `${BASE_URL}/stats`,
                { method: 'GET', headers: buildHeaders() }
            );
            return parseResponse(response, 'getGlobalStats');
        } catch (error) {
            logError(error, { context: 'orderClient.getGlobalStats' });
            throw error;
        }
    },

    /**
     * Historique des ventes journalières pour le graphique du dashboard.
     * @param {number} days - Fenêtre temporelle (1–365)
     */
    async getDailySalesHistory(days = 30) {
        try {
            const response = await fetchWithTimeout(
                `${BASE_URL}/sales-history?days=${days}`,
                { method: 'GET', headers: buildHeaders() }
            );
            return parseResponse(response, 'getDailySalesHistory');
        } catch (error) {
            logError(error, { context: 'orderClient.getDailySalesHistory' });
            throw error;
        }
    },

    /**
     * Rapport de ventes sur une période donnée.
     * @param {string} startDate - Format ISO
     * @param {string} endDate   - Format ISO
     */
    async getSalesReport(startDate, endDate) {
        try {
            const response = await fetchWithTimeout(
                `${BASE_URL}/sales-report?startDate=${startDate}&endDate=${endDate}`,
                { method: 'GET', headers: buildHeaders() }
            );
            return parseResponse(response, 'getSalesReport');
        } catch (error) {
            logError(error, { context: 'orderClient.getSalesReport' });
            throw error;
        }
    },

    // ── Déclencheurs de cron ──────────────────────────────────────────────────

    /** Annule les commandes PENDING > 24h et libère le stock réservé. */
    async triggerOrdersCleanup() {
        try {
            const response = await fetchWithTimeout(
                `${BASE_URL}/crons/orders-cleanup`,
                { method: 'POST', headers: buildHeaders() }
            );
            return parseResponse(response, 'triggerOrdersCleanup');
        } catch (error) {
            logError(error, { context: 'orderClient.triggerOrdersCleanup' });
            throw error;
        }
    },

    /** Archive les commandes de plus de 2 ans. */
    async triggerArchive() {
        try {
            const response = await fetchWithTimeout(
                `${BASE_URL}/crons/archive`,
                { method: 'POST', headers: buildHeaders() }
            );
            return parseResponse(response, 'triggerArchive');
        } catch (error) {
            logError(error, { context: 'orderClient.triggerArchive' });
            throw error;
        }
    },

    /** Rafraîchit les vues matérialisées des statistiques. */
    async triggerStatsRefresh() {
        try {
            const response = await fetchWithTimeout(
                `${BASE_URL}/crons/stats-refresh`,
                { method: 'POST', headers: buildHeaders() }
            );
            return parseResponse(response, 'triggerStatsRefresh');
        } catch (error) {
            logError(error, { context: 'orderClient.triggerStatsRefresh' });
            throw error;
        }
    },

    /** Libère le stock des paniers abandonnés. */
    async triggerInventoryCleanup() {
        try {
            const response = await fetchWithTimeout(
                `${BASE_URL}/crons/inventory-cleanup`,
                { method: 'POST', headers: buildHeaders() }
            );
            return parseResponse(response, 'triggerInventoryCleanup');
        } catch (error) {
            logError(error, { context: 'orderClient.triggerInventoryCleanup' });
            throw error;
        }
    },
};
