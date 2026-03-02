/**
 * @module Clients/Inventory
 *
 * Client HTTP vers les endpoints internes du monolith pour les opérations de stock.
 * Remplace les appels directs à `inventoryRepo` qui référençaient le schéma `product`.
 *
 * Toutes les méthodes lèvent une erreur en cas d'échec pour déclencher
 * la saga compensatoire dans `orders.service.js`.
 */
import { ENV } from '../config/environment.js';
import { logError } from '../utils/logger.js';

// product-service expose ses routes internes à la racine /internal
// (pas sous /api/v1 — les routes internes ne passent pas par le Gateway)
const BASE_URL = `${ENV.services.productServiceUrl}/internal/inventory`;
const TIMEOUT_MS = ENV.services.httpTimeoutMs;

// ── Utilitaires ───────────────────────────────────────────────────────────────

/**
 * Construit les headers communs à tous les appels internes.
 * Le secret est validé côté monolith par `internal.middleware.js`.
 */
const buildHeaders = () => ({
    'Content-Type': 'application/json',
    // Secret partagé avec le product-service (INTERNAL_PRODUCT_SECRET)
    'X-Internal-Secret': ENV.internal.productSecret,
});

/**
 * Exécute un fetch avec timeout.
 * Sans timeout, un monolith lent bloquerait indéfiniment la création de commande.
 */
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

/**
 * Parse la réponse HTTP et lève une erreur structurée si le statut n'est pas 2xx.
 * Centraliser ici évite de répéter la logique de vérification dans chaque méthode.
 */
const parseResponse = async (response, context) => {
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
        const message = body?.message || `HTTP ${response.status}`;
        const error = new Error(`[inventoryClient.${context}] ${message}`);
        error.statusCode = response.status;
        error.body = body;
        throw error;
    }

    return body?.data ?? body;
};

// ── Client ────────────────────────────────────────────────────────────────────

export const inventoryClient = {

    /**
     * Réserve du stock pour un article en cours de commande.
     * Retourne les données d'inventaire (price, weight) nécessaires au calcul des totaux.
     *
     * @throws {Error} Si le stock est insuffisant (409) ou si le monolith est inaccessible
     */
    async reserve(variantId, quantity) {
        try {
            const response = await fetchWithTimeout(`${BASE_URL}/reserve`, {
                method: 'POST',
                headers: buildHeaders(),
                body: JSON.stringify({ variantId, quantity }),
            });

            return await parseResponse(response, 'reserve');
        } catch (error) {
            logError(error, { context: 'inventoryClient.reserve', variantId, quantity });
            throw error;
        }
    },

    /**
     * Libère du stock précédemment réservé (annulation ou expiration).
     * Opération best-effort : ne bloque pas le flux si le monolith est indisponible.
     *
     * @throws {Error} Uniquement si la requête échoue avec un code non-réseau
     */
    async release(variantId, quantity) {
        try {
            const response = await fetchWithTimeout(`${BASE_URL}/release`, {
                method: 'POST',
                headers: buildHeaders(),
                body: JSON.stringify({ variantId, quantity }),
            });

            return await parseResponse(response, 'release');
        } catch (error) {
            logError(error, { context: 'inventoryClient.release', variantId, quantity });
            throw error;
        }
    },

    /**
     * Confirme la sortie définitive du stock après paiement Stripe validé.
     * Appelé uniquement depuis le webhook de paiement, via la route interne.
     *
     * @throws {Error} Si le stock réservé est insuffisant ou si le monolith est inaccessible
     */
    async confirmSale(variantId, quantity) {
        try {
            const response = await fetchWithTimeout(`${BASE_URL}/confirm`, {
                method: 'POST',
                headers: buildHeaders(),
                body: JSON.stringify({ variantId, quantity }),
            });

            return await parseResponse(response, 'confirmSale');
        } catch (error) {
            logError(error, { context: 'inventoryClient.confirmSale', variantId, quantity });
            throw error;
        }
    },
};