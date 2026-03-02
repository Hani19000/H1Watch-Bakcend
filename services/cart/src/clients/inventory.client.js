/**
 * @module Clients/Inventory
 *
 * Client HTTP vers les endpoints internes du monolith pour vérifier
 * la disponibilité du stock avant toute mutation du panier.
 *
 * Le cart-service ne réserve pas de stock (pas de transaction d'achat).
 * Il vérifie uniquement la disponibilité pour une UX cohérente.
 * La réservation définitive reste la responsabilité de l'order-service.
 */
import { ENV } from '../config/environment.js';
import { logError } from '../utils/logger.js';

const BASE_URL = `${ENV.services.monolithUrl}/api/v1/internal/inventory`;
const TIMEOUT_MS = ENV.services.httpTimeoutMs;

// ── Utilitaires ───────────────────────────────────────────────────────────────

const buildHeaders = () => ({
    'Content-Type': 'application/json',
    'X-Internal-Secret': ENV.internal.cartSecret,
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
        const error = new Error(`[inventoryClient.${context}] ${message}`);
        error.statusCode = response.status;
        throw error;
    }
    return body?.data ?? body;
};

// ── Client ────────────────────────────────────────────────────────────────────

export const inventoryClient = {

    /**
     * Vérifie si une variante est disponible en quantité suffisante.
     * Retourne { availableStock, reservedStock } pour que le service
     * puisse produire un message d'erreur précis à l'utilisateur.
     *
     * @throws {Error} Si le monolith est inaccessible
     */
    async checkAvailability(variantId, quantity) {
        try {
            const response = await fetchWithTimeout(
                `${BASE_URL}/availability?variantId=${variantId}&quantity=${quantity}`,
                { method: 'GET', headers: buildHeaders() }
            );
            return await parseResponse(response, 'checkAvailability');
        } catch (error) {
            logError(error, { context: 'inventoryClient.checkAvailability', variantId, quantity });
            throw error;
        }
    },
};
