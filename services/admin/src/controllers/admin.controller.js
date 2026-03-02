/**
 * @module Controller/Admin
 *
 * Interface HTTP du tableau de bord administrateur.
 * Responsabilité unique : extraire les paramètres de la requête,
 * déléguer au service, formater la réponse.
 *
 * Aucune logique métier ici — tout est dans adminService.
 */
import { adminService } from '../services/admin.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';

class AdminController {

    /**
     * GET /api/v1/admin/stats
     * Agrège les statistiques de la plateforme depuis tous les services.
     */
    getStats = asyncHandler(async (_req, res) => {
        const stats = await adminService.getDashboardStats();

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: stats,
        });
    });

    /**
     * GET /api/v1/admin/sales-history?days=30
     * Historique des ventes journalières pour le graphique du dashboard.
     * Le paramètre `days` est validé dans adminService.getSalesHistory.
     */
    getSalesHistory = asyncHandler(async (req, res) => {
        const { days = 30 } = req.query;
        const history = await adminService.getSalesHistory(days);

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: { history },
        });
    });

    /**
     * GET /api/v1/admin/users
     * Liste paginée des utilisateurs avec filtres.
     * Délégué à l'auth-service — le JWT admin est forwardé.
     */
    getUsers = asyncHandler(async (req, res) => {
        const { search, page, limit } = req.query;
        const result = await adminService.listUsers(
            { search, page, limit },
            req.headers.authorization
        );

        res.status(HTTP_STATUS.OK).json(result);
    });

    /**
     * PATCH /api/v1/admin/users/:userId
     * Modifie le rôle ou le statut actif d'un utilisateur.
     * Délégué à l'auth-service — le JWT admin est forwardé.
     */
    updateUserPrivileges = asyncHandler(async (req, res) => {
        const { userId } = req.params;
        const { role, isActive } = req.body;

        const result = await adminService.updateUserPrivileges(
            userId,
            { role, isActive },
            req.headers.authorization
        );

        res.status(HTTP_STATUS.OK).json(result);
    });

    /**
     * DELETE /api/v1/admin/users/:userId
     * Supprime un compte utilisateur.
     * Délégué à l'auth-service — le JWT admin est forwardé.
     */
    deleteUser = asyncHandler(async (req, res) => {
        const { userId } = req.params;
        await adminService.deleteUser(userId, req.headers.authorization);
        res.status(HTTP_STATUS.NO_CONTENT).send();
    });
}

export const adminController = new AdminController();
