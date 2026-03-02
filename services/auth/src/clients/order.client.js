/**
 * @module Client/Order
 *
 * Client HTTP interne pour communiquer avec l'order-service.
 *
 * RESPONSABILITÉ UNIQUE : transporter les appels vers order-service
 * via HTTP sécurisé, sans aucune logique métier.
 *
 * SÉCURITÉ :
 * - Authentification inter-services via header X-Internal-Secret
 * - Timeout strict pour éviter les attaques de type slowloris
 * - Aucune donnée sensible loguée (email masqué, pas de token)
 * - Validation des paramètres avant envoi
 * - Dégradation gracieuse : un échec ne bloque jamais l'auth
 */

import { ENV } from '../config/environment.js';
import { logInfo, logError } from '../utils/logger.js';

// ─── Constantes ──────────────────────────────────────────────────────────────

const ORDER_SERVICE_URL = ENV.services.orderServiceUrl;
const INTERNAL_AUTH_SECRET = ENV.services.internalSecret;
const REQUEST_TIMEOUT_MS = 5_000;

// ─── Helpers privés ───────────────────────────────────────────────────────────

/**
 * Masque partiellement un email pour les logs.
 * "john.doe@example.com" → "jo***@example.com"
 */
function maskEmail(email) {
    if (!email || typeof email !== 'string') return '[invalid]';
    const [local, domain] = email.split('@');
    if (!domain) return '[invalid]';
    const masked = local.slice(0, 2).padEnd(local.length, '*');
    return `${masked}@${domain}`;
}

/**
 * Construit les headers communs à tous les appels inter-services.
 */
function buildInternalHeaders() {
    return {
        'Content-Type': 'application/json',
        'X-Internal-Secret': INTERNAL_AUTH_SECRET,
        'X-Source-Service': 'auth-service',
    };
}

/**
 * Effectue un fetch avec timeout via AbortController.
 */
async function fetchWithTimeout(url, options, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timerId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timerId);
    }
}

// ─── Fonctions publiques ──────────────────────────────────────────────────────

/**
 * Transfère les commandes guest vers un compte utilisateur.
 * Appelé après register() et login() dans auth.service.js.
 *
 * Ne lève jamais d'exception — retourne { claimed: 0, error } en cas d'échec.
 *
 * @param {string} userId
 * @param {string} email
 * @returns {Promise<{ claimed: number, claimedOrderNumbers: string[] } | { claimed: 0, error: string }>}
 */
async function claimGuestOrders(userId, email) {
    if (!userId || typeof userId !== 'string') {
        return { claimed: 0, error: 'userId invalide' };
    }
    if (!email || typeof email !== 'string' || !email.includes('@')) {
        return { claimed: 0, error: 'email invalide' };
    }

    const endpoint = `${ORDER_SERVICE_URL}/internal/orders/claim`;

    try {
        logInfo('Auto-claim guest orders', { userId, email: maskEmail(email) });

        const response = await fetchWithTimeout(endpoint, {
            method: 'POST',
            headers: buildInternalHeaders(),
            body: JSON.stringify({ userId, email }),
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => 'no body');
            logError(new Error(`order-service responded with ${response.status}`), {
                context: 'orderClient.claimGuestOrders',
                status: response.status,
                body: ENV.server.isProduction ? '[redacted]' : errorBody,
            });
            return { claimed: 0, error: `order-service error: ${response.status}` };
        }

        const data = await response.json();
        logInfo('Auto-claim terminé', { userId, claimed: data.claimed ?? 0 });

        return {
            claimed: data.claimed ?? 0,
            claimedOrderNumbers: data.claimedOrderNumbers ?? [],
        };

    } catch (error) {
        const isTimeout = error.name === 'AbortError';
        logError(error, {
            context: 'orderClient.claimGuestOrders',
            reason: isTimeout ? 'timeout' : 'network_error',
            userId,
        });
        return {
            claimed: 0,
            error: isTimeout ? 'order-service timeout' : 'order-service unreachable',
        };
    }
}

/**
 * Récupère l'historique paginé des commandes d'un utilisateur.
 * Appelé par users.controller.js → GET /users/me/orders
 *
 * Ne lève jamais d'exception — retourne des données vides en cas d'échec.
 *
 * @param {string} userId
 * @param {{ page: number, limit: number, status?: string }} options
 * @returns {Promise<{ orders: [], pagination: {} }>}
 */
async function getOrderHistory(userId, { page = 1, limit = 10, status } = {}) {
    if (!userId || typeof userId !== 'string') {
        return { orders: [], pagination: {} };
    }

    const params = new URLSearchParams({ page, limit });
    if (status) params.set('status', status);

    const endpoint = `${ORDER_SERVICE_URL}/internal/orders/user/${userId}?${params}`;

    try {
        const response = await fetchWithTimeout(endpoint, {
            method: 'GET',
            headers: buildInternalHeaders(),
        });

        if (!response.ok) {
            logError(new Error(`order-service responded with ${response.status}`), {
                context: 'orderClient.getOrderHistory',
                status: response.status,
                userId,
            });
            return { orders: [], pagination: {} };
        }

        const body = await response.json();

        // L'order-service enveloppe toujours la réponse dans { status, data: { orders, pagination } }
        return {
            orders: body?.data?.orders ?? [],
            pagination: body?.data?.pagination ?? {},
        };

    } catch (error) {
        const isTimeout = error.name === 'AbortError';
        logError(error, {
            context: 'orderClient.getOrderHistory',
            reason: isTimeout ? 'timeout' : 'network_error',
            userId,
        });
        return { orders: [], pagination: {} };
    }
}

/**
 * Récupère les statistiques de commande d'un utilisateur.
 * Appelé par users.service.js → getUserProfile()
 *
 * Ne lève jamais d'exception — retourne null si order-service indisponible.
 * Le profil utilisateur est retourné normalement, sans stats.
 *
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
async function getUserStats(userId) {
    if (!userId || typeof userId !== 'string') return null;

    const endpoint = `${ORDER_SERVICE_URL}/internal/orders/user/${userId}/stats`;

    try {
        const response = await fetchWithTimeout(endpoint, {
            method: 'GET',
            headers: buildInternalHeaders(),
        });

        if (!response.ok) {
            logError(new Error(`order-service responded with ${response.status}`), {
                context: 'orderClient.getUserStats',
                status: response.status,
                userId,
            });
            return null;
        }

        // L'order-service répond { status, data: { stats: {...} } }
        const body = await response.json();
        return body?.data?.stats ?? null;

    } catch (error) {
        const isTimeout = error.name === 'AbortError';
        logError(error, {
            context: 'orderClient.getUserStats',
            reason: isTimeout ? 'timeout' : 'network_error',
            userId,
        });
        return null;
    }
}

// ─── Export ───────────────────────────────────────────────────────────────────

export const orderClient = { claimGuestOrders, getOrderHistory, getUserStats };