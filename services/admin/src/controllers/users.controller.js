/**
 * @module Controllers/Users
 *
 * Gestion des comptes utilisateurs réservée aux administrateurs.
 * Ce contrôleur délègue toutes les opérations à adminService, qui les
 * transmet à l'auth-service via HTTP. La logique métier (gardes anti-auto-
 * modification, vérification des rôles admin) reste dans l'auth-service.
 */
import { adminService } from '../services/admin.service.js';

class UsersController {
    /**
     * GET /api/v1/admin/users?search=&page=&limit=
     * Liste paginée des utilisateurs avec leurs rôles.
     */
    listUsers = async (req, res, next) => {
        try {
            const params = {
                search: req.query.search || null,
                page: parseInt(req.query.page, 10) || 1,
                limit: parseInt(req.query.limit, 10) || 10,
            };

            const result = await adminService.listUsers(params);

            res.status(200).json({
                status: 'success',
                data: {
                    users: result.users || [],
                    pagination: result.pagination || null,
                },
            });
        } catch (err) {
            next(err);
        }
    };

    /**
     * PATCH /api/v1/admin/users/:userId/privileges
     * Modifie le rôle et/ou le statut actif d'un utilisateur.
     * L'ID de l'admin courant est transmis pour les gardes de sécurité.
     */
    updatePrivileges = async (req, res, next) => {
        try {
            const { userId } = req.params;
            const { role, isActive } = req.body;

            const updatedUser = await adminService.updateUserPrivileges(
                userId,
                { role, isActive },
                req.user.id
            );

            res.status(200).json({
                status: 'success',
                message: 'Privilèges mis à jour avec succès',
                data: { user: updatedUser },
            });
        } catch (err) {
            next(err);
        }
    };

    /**
     * DELETE /api/v1/admin/users/:userId
     * Supprime un compte utilisateur.
     * L'ID de l'admin courant est transmis pour la garde anti-auto-suppression.
     */
    deleteUser = async (req, res, next) => {
        try {
            await adminService.deleteUser(req.params.userId, req.user.id);
            res.status(204).send();
        } catch (err) {
            next(err);
        }
    };
}

export const usersController = new UsersController();
