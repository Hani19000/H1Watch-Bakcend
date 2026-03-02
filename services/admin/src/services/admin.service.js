/**
 * @module Service/Admin
 *
 * Orchestre les données transversales pour le tableau de bord.
 * Pattern agrégateur : toutes les données proviennent des services pairs
 * via HTTP — aucun accès direct à la base de données.
 *
 * Cache Redis (TTL 5 min) sur getDashboardStats pour éviter de solliciter
 * 3 services à chaque rafraîchissement de page.
 */
import { authClient } from '../clients/auth.client.js';
import { orderClient } from '../clients/order.client.js';
import { productClient } from '../clients/product.client.js';
import { cacheService } from './cache.service.js';
import { logError } from '../utils/logger.js';
import { AppError } from '../utils/appError.js';
import { ENV } from '../config/environment.js';

const DASHBOARD_CACHE_KEY = 'dashboard:stats';

class AdminService {
    constructor() {
        if (AdminService.instance) return AdminService.instance;
        AdminService.instance = this;
        Object.freeze(this);
    }

    /**
     * Agrège les statistiques globales depuis 3 services en parallèle.
     * Le résultat est mis en cache 5 min pour éviter 3 appels HTTP à chaque
     * rafraîchissement du dashboard.
     * En cas d'échec d'un service, retourne un fallback partiel plutôt que de bloquer.
     */
    async getDashboardStats() {
        const cached = await cacheService.get(DASHBOARD_CACHE_KEY);
        if (cached) return cached;

        const [userCountResult, orderStatsResult, productStatsResult] = await Promise.allSettled([
            authClient.countUsers(),
            orderClient.getGlobalStats(),
            productClient.getStats(),
        ]);

        const userCount = userCountResult.status === 'fulfilled'
            ? userCountResult.value?.count ?? 0
            : (logError(userCountResult.reason, { context: 'getDashboardStats.userCount' }), 0);

        const orderStats = orderStatsResult.status === 'fulfilled'
            ? orderStatsResult.value
            : (logError(orderStatsResult.reason, { context: 'getDashboardStats.orderStats' }), null);

        const productStats = productStatsResult.status === 'fulfilled'
            ? productStatsResult.value
            : (logError(productStatsResult.reason, { context: 'getDashboardStats.productStats' }), null);

        const stats = {
            users: {
                total: userCount,
            },
            orders: {
                totalSales: orderStats?.totalAmount ?? 0,
                orderCount: orderStats?.count ?? 0,
                averageOrderValue: (orderStats?.count > 0)
                    ? parseFloat((orderStats.totalAmount / orderStats.count).toFixed(2))
                    : 0,
            },
            inventory: {
                alerts: productStats?.lowStockCount ?? 0,
            },
            products: {
                total: productStats?.totalProducts ?? 0,
            },
            timestamp: new Date(),
        };

        await cacheService.set(DASHBOARD_CACHE_KEY, stats, ENV.redis.statsTtl);

        return stats;
    }

    /**
     * Historique des ventes journalières pour le graphique du dashboard.
     * Délègue à l'order-service — aucun calcul applicatif ici.
     *
     * @param {number} days - Fenêtre temporelle en jours (1–365)
     */
    async getSalesHistory(days = 30) {
        const parsed = parseInt(days, 10);

        if (isNaN(parsed) || parsed < 1 || parsed > 365) {
            throw new AppError('Le paramètre days doit être compris entre 1 et 365', 400);
        }

        return orderClient.getDailySalesHistory(parsed);
    }

    /**
     * Rapport de ventes sur une période donnée.
     * @param {string} startDate - Format ISO
     * @param {string} endDate   - Format ISO
     */
    async getSalesReport(startDate, endDate) {
        if (!startDate || !endDate) {
            throw new AppError('Les dates de début et de fin sont requises', 400);
        }
        return orderClient.getSalesReport(startDate, endDate);
    }

    /**
     * Met à jour le rôle et/ou le statut d'un utilisateur.
     * La logique de garde (pas d'auto-modification, pas de modification d'admin)
     * est centralisée dans l'auth-service — on lui transmet l'adminId.
     *
     * @param {string} targetUserId
     * @param {{ role?, isActive? }} payload
     * @param {string} adminId - ID de l'admin connecté
     */
    async updateUserPrivileges(targetUserId, payload, adminId) {
        return authClient.updateUserPrivileges(targetUserId, payload, adminId);
    }

    /**
     * Supprime un compte utilisateur.
     * @param {string} targetUserId
     * @param {string} adminId - ID de l'admin connecté (garde anti-auto-suppression)
     */
    async deleteUser(targetUserId, adminId) {
        return authClient.deleteUser(targetUserId, adminId);
    }

    /**
     * Liste les utilisateurs avec pagination et recherche.
     * @param {{ search?, page?, limit? }} params
     */
    async listUsers(params) {
        return authClient.listUsers(params);
    }

    /**
     * Invalide manuellement le cache du dashboard.
     * Utile après un batch d'opérations qui modifient les stats.
     */
    async invalidateDashboardCache() {
        await cacheService.delete(DASHBOARD_CACHE_KEY);
    }
}

export const adminService = new AdminService();
