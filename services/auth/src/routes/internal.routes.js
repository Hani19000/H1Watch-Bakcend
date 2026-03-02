/**
 * @module Routes/Internal — auth-service
 *
 * Endpoints exclusivement appelés par l'admin-service.
 * Non exposés via le Gateway Nginx.
 *
 * Périmètre :
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ GET   /internal/admin/users                       → liste paginée        │
 * │ GET   /internal/admin/users/count                 → compteur total       │
 * │ PATCH /internal/admin/users/:userId/privileges    → rôle + statut actif  │
 * │ DELETE /internal/admin/users/:userId              → suppression compte   │
 * │ POST  /internal/admin/crons/sessions-cleanup      → trigger cron        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * GARDES DE SÉCURITÉ SUR LES OPÉRATIONS SENSIBLES :
 * - Pas d'auto-modification (adminId !== targetUserId)
 * - Pas de modification/suppression d'un autre administrateur
 * Ces gardes sont appliquées ici dans l'auth-service, propriétaire du schéma
 * "auth", pour garantir leur immuabilité indépendamment du service appelant.
 */
import { Router } from 'express';
import { usersRepo, rolesRepo } from '../repositories/index.js';
import { fromAdminService } from '../middlewares/internal.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { AppError } from '../utils/appError.js';
import { validateUUID } from '../utils/validation.js';
import { sessionsCleanupJob } from '../jobs/sessions.cron.js';

const router = Router();

// Toutes les routes /internal/admin sont protégées par le secret de l'admin-service
router.use('/admin', fromAdminService);

// ── Utilisateurs ──────────────────────────────────────────────────────────────

/**
 * GET /internal/admin/users
 * Liste paginée des utilisateurs avec leurs rôles.
 * Appelé par l'admin-service pour afficher et filtrer les comptes.
 */
router.get(
    '/admin/users',
    asyncHandler(async (req, res) => {
        const params = {
            search: req.query.search || null,
            page: parseInt(req.query.page, 10) || 1,
            limit: parseInt(req.query.limit, 10) || 10,
        };

        const result = await usersRepo.list(params);

        // Enrichit chaque utilisateur avec ses rôles — la projection liste()
        // n'inclut pas les rôles pour éviter les N+1 dans les autres contextes.
        const usersWithRoles = await Promise.all(
            result.users.map(async (user) => {
                const roles = await rolesRepo.listUserRoles(user.id);
                return { ...user, roles: roles.map((r) => r.name) };
            })
        );

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: { users: usersWithRoles, pagination: result.pagination },
        });
    })
);

/**
 * GET /internal/admin/users/count
 * Nombre total d'utilisateurs enregistrés.
 * Appelé par l'admin-service pour alimenter le widget du dashboard.
 */
router.get(
    '/admin/users/count',
    asyncHandler(async (req, res) => {
        const count = await usersRepo.count();

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: { count },
        });
    })
);

/**
 * PATCH /internal/admin/users/:userId/privileges
 * Met à jour le rôle et/ou le statut actif d'un utilisateur.
 *
 * GARDES :
 * - Un admin ne peut pas modifier ses propres privilèges (boucle d'auto-élévation)
 * - Un admin ne peut pas modifier un autre administrateur (seul un super-admin le peut)
 */
router.patch(
    '/admin/users/:userId/privileges',
    asyncHandler(async (req, res) => {
        const { userId } = req.params;
        validateUUID(userId, 'userId');

        const { role, isActive, adminId } = req.body;

        if (!adminId) {
            throw new AppError('adminId requis', HTTP_STATUS.BAD_REQUEST);
        }

        validateUUID(adminId, 'adminId');

        // Garde : pas d'auto-modification
        if (userId === adminId) {
            throw new AppError(
                'Opération interdite : un administrateur ne peut pas modifier ses propres privilèges',
                HTTP_STATUS.FORBIDDEN
            );
        }

        // Garde : pas de modification d'un autre administrateur
        const targetRoles = await rolesRepo.listUserRoles(userId);
        const isTargetAdmin = targetRoles.some((r) => r.name.toUpperCase() === 'ADMIN');

        if (isTargetAdmin) {
            throw new AppError(
                'Opération interdite : modification d\'un compte administrateur refusée',
                HTTP_STATUS.FORBIDDEN
            );
        }

        // Mise à jour du statut actif
        if (isActive !== undefined) {
            await usersRepo.setActive(userId, isActive);
        }

        // Mise à jour du rôle
        if (role) {
            await updateUserRole(userId, role, targetRoles);
        }

        const updatedUser = await usersRepo.findById(userId);
        const updatedRoles = await rolesRepo.listUserRoles(userId);

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: {
                user: { ...updatedUser, roles: updatedRoles.map((r) => r.name) },
            },
        });
    })
);

/**
 * DELETE /internal/admin/users/:userId
 * Supprime un compte utilisateur.
 *
 * GARDES :
 * - Pas d'auto-suppression
 * - Pas de suppression d'un autre administrateur
 */
router.delete(
    '/admin/users/:userId',
    asyncHandler(async (req, res) => {
        const { userId } = req.params;
        validateUUID(userId, 'userId');

        const { adminId } = req.body;

        if (!adminId) {
            throw new AppError('adminId requis', HTTP_STATUS.BAD_REQUEST);
        }

        validateUUID(adminId, 'adminId');

        // Garde : pas d'auto-suppression
        if (userId === adminId) {
            throw new AppError(
                'Opération interdite : un administrateur ne peut pas supprimer son propre compte',
                HTTP_STATUS.FORBIDDEN
            );
        }

        // Garde : pas de suppression d'un autre administrateur
        const targetRoles = await rolesRepo.listUserRoles(userId);
        const isTargetAdmin = targetRoles.some((r) => r.name.toUpperCase() === 'ADMIN');

        if (isTargetAdmin) {
            throw new AppError(
                'Opération interdite : suppression d\'un compte administrateur refusée',
                HTTP_STATUS.FORBIDDEN
            );
        }

        await usersRepo.deleteById(userId);

        res.status(HTTP_STATUS.NO_CONTENT).send();
    })
);

// ── Crons ─────────────────────────────────────────────────────────────────────

/**
 * POST /internal/admin/crons/sessions-cleanup
 * Déclenche manuellement la suppression des tokens expirés.
 * Appelé par le cron sessions-cleanup de l'admin-service.
 */
router.post(
    '/admin/crons/sessions-cleanup',
    asyncHandler(async (req, res) => {
        const result = await sessionsCleanupJob.execute();

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: result,
        });
    })
);

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS PRIVÉS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Met à jour le rôle d'un utilisateur en gérant les transitions ADMIN ↔ USER.
 * Séparé en fonction pour respecter le principe de responsabilité unique.
 *
 * @param {string} userId
 * @param {string} newRole - 'ADMIN' | 'USER'
 * @param {Array}  currentRoles - rôles actuels de l'utilisateur
 */
async function updateUserRole(userId, newRole, currentRoles) {
    const normalizedRole = newRole.toUpperCase();

    if (normalizedRole === 'ADMIN') {
        const adminRoleDef = await rolesRepo.findByName('ADMIN');
        if (adminRoleDef) {
            await rolesRepo.addUserRole(userId, adminRoleDef.id);
        }
        return;
    }

    if (normalizedRole === 'USER') {
        // Retire le rôle ADMIN si présent
        const adminRoleAssigned = currentRoles.find((r) => r.name.toUpperCase() === 'ADMIN');
        if (adminRoleAssigned) {
            await rolesRepo.removeUserRole(userId, adminRoleAssigned.id);
        }

        // Assure la présence du rôle USER de base
        const hasUserRole = currentRoles.some((r) => r.name.toUpperCase() === 'USER');
        if (!hasUserRole) {
            const userRoleDef = await rolesRepo.findByName('USER');
            if (userRoleDef) {
                await rolesRepo.addUserRole(userId, userRoleDef.id);
            }
        }
    }
}

export default router;
