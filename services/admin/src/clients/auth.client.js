/**
 * @module Clients/Auth
 *
 * Client HTTP vers l'auth-service pour les opérations d'administration.
 * Toutes les opérations sur les utilisateurs restent dans l'auth-service
 * qui est propriétaire du schéma "auth" — l'admin-service délègue, ne duplique pas.
 */
import { ENV } from '../config/environment.js';
import { logError } from '../utils/logger.js';

const BASE_URL = `${ENV.services.authServiceUrl}/internal/admin`;
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
        const error = new Error(`[authClient.${context}] HTTP ${response.status}: ${body?.message || ''}`);
        error.statusCode = response.status;
        error.isOperational = true;
        throw error;
    }
    return body?.data ?? body;
};

export const authClient = {

    /**
     * Liste les utilisateurs avec filtre et pagination.
     * @param {{ search?, page?, limit? }} params
     */
    async listUsers(params = {}) {
        const qs = new URLSearchParams(
            Object.fromEntries(Object.entries(params).filter(([, v]) => v != null))
        ).toString();
        try {
            const response = await fetchWithTimeout(
                `${BASE_URL}/users${qs ? `?${qs}` : ''}`,
                { method: 'GET', headers: buildHeaders() }
            );
            return parseResponse(response, 'listUsers');
        } catch (error) {
            logError(error, { context: 'authClient.listUsers' });
            throw error;
        }
    },

    /**
     * Retourne le nombre total d'utilisateurs enregistrés.
     */
    async countUsers() {
        try {
            const response = await fetchWithTimeout(
                `${BASE_URL}/users/count`,
                { method: 'GET', headers: buildHeaders() }
            );
            return parseResponse(response, 'countUsers');
        } catch (error) {
            logError(error, { context: 'authClient.countUsers' });
            throw error;
        }
    },

    /**
     * Met à jour le rôle et/ou le statut actif d'un utilisateur.
     * La logique de garde (pas d'auto-modification, pas de modification d'admin)
     * est appliquée dans l'auth-service — l'admin-service transmet l'adminId.
     *
     * @param {string} targetUserId
     * @param {{ role?, isActive? }} payload
     * @param {string} adminId - ID de l'admin qui effectue la modification
     */
    async updateUserPrivileges(targetUserId, payload, adminId) {
        try {
            const response = await fetchWithTimeout(
                `${BASE_URL}/users/${targetUserId}/privileges`,
                {
                    method: 'PATCH',
                    headers: buildHeaders(),
                    body: JSON.stringify({ ...payload, adminId }),
                }
            );
            return parseResponse(response, 'updateUserPrivileges');
        } catch (error) {
            logError(error, { context: 'authClient.updateUserPrivileges', targetUserId });
            throw error;
        }
    },

    /**
     * Supprime un compte utilisateur.
     * La logique de garde (pas d'auto-suppression, pas de suppression d'admin)
     * est appliquée dans l'auth-service.
     *
     * @param {string} targetUserId
     * @param {string} adminId - ID de l'admin qui effectue la suppression
     */
    async deleteUser(targetUserId, adminId) {
        try {
            const response = await fetchWithTimeout(
                `${BASE_URL}/users/${targetUserId}`,
                {
                    method: 'DELETE',
                    headers: buildHeaders(),
                    body: JSON.stringify({ adminId }),
                }
            );
            return parseResponse(response, 'deleteUser');
        } catch (error) {
            logError(error, { context: 'authClient.deleteUser', targetUserId });
            throw error;
        }
    },

    /**
     * Déclenche le nettoyage des refresh tokens expirés.
     * Appelé par le cron sessions-cleanup dans l'admin-service.
     */
    async triggerSessionsCleanup() {
        try {
            const response = await fetchWithTimeout(
                `${BASE_URL}/crons/sessions-cleanup`,
                { method: 'POST', headers: buildHeaders() }
            );
            return parseResponse(response, 'triggerSessionsCleanup');
        } catch (error) {
            logError(error, { context: 'authClient.triggerSessionsCleanup' });
            throw error;
        }
    },
};
