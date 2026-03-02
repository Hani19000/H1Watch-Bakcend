/**
 * @module Controllers/Dashboard
 *
 * Expose les statistiques globales du tableau de bord administrateur.
 * Les calculs et l'agrégation sont délégués à adminService — ce contrôleur
 * se limite à la mise en forme de la réponse HTTP.
 */
import { adminService } from '../services/admin.service.js';

class DashboardController {
    /**
     * GET /api/v1/admin/stats
     * Statistiques globales : utilisateurs, commandes, produits, alertes stock.
     * Résultat mis en cache 5 min — voir adminService.getDashboardStats.
     */
    getStats = async (req, res, next) => {
        try {
            const stats = await adminService.getDashboardStats();
            res.status(200).json({ status: 'success', data: stats });
        } catch (err) {
            next(err);
        }
    };

    /**
     * GET /api/v1/admin/sales-history?days=30
     * Historique des ventes journalières pour le graphique du dashboard.
     * Paramètre `days` validé dans adminService (1–365, défaut : 30).
     */
    getSalesHistory = async (req, res, next) => {
        try {
            const { days = 30 } = req.query;
            const history = await adminService.getSalesHistory(days);
            res.status(200).json({ status: 'success', data: { history } });
        } catch (err) {
            next(err);
        }
    };

    /**
     * GET /api/v1/admin/sales-report?startDate=...&endDate=...
     * Rapport de ventes sur une période donnée.
     */
    getSalesReport = async (req, res, next) => {
        try {
            const { startDate, endDate } = req.query;
            const report = await adminService.getSalesReport(startDate, endDate);
            res.status(200).json({ status: 'success', data: { report } });
        } catch (err) {
            next(err);
        }
    };

    /**
     * POST /api/v1/admin/cache/invalidate
     * Invalide manuellement le cache du dashboard.
     * Utile après une opération batch qui modifie les stats (import produits, etc.).
     */
    invalidateCache = async (req, res, next) => {
        try {
            await adminService.invalidateDashboardCache();
            res.status(200).json({
                status: 'success',
                message: 'Cache du dashboard invalidé',
            });
        } catch (err) {
            next(err);
        }
    };
}

export const dashboardController = new DashboardController();
