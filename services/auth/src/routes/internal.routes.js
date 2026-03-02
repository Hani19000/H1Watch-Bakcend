/**
 * @module Routes/Internal — auth-service
 *
 * Endpoints exclusivement appelés par l'admin-service.
 * Ces routes ne sont jamais exposées via le Gateway Nginx.
 *
 * Périmètre :
 * ┌────────────────────────────────────────────────────────────────────┐
 * │ GET  /internal/admin/users               → liste paginée           │
 * │ GET  /internal/admin/users/count         → total utilisateurs      │
 * │ PATCH /internal/admin/users/:id/privileges → rôle + statut actif   │
 * │ DELETE /internal/admin/users/:id         → suppression compte      │
 * │ POST /internal/admin/crons/sessions-cleanup → purge tokens expirés │
 * └────────────────────────────────────────────────────────────────────┘
 *
 * Toutes les routes sont protégées par `fromAdminService`.
 * La logique métier reste dans `usersService` et `sessionsCleanupJob`
 * — cette couche route ne fait que déléguer et formater la réponse HTTP.
 */
import { Router } from 'express';
import { usersService } from '../services/users.service.js';
import { usersRepo } from '../repositories/index.js';
import { sessionsCleanupJob } from '../jobs/sessions.cron.js';
import { fromAdminService } from '../middlewares/internal.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { ValidationError } from '../utils/appError.js';
import { validateUUID } from '../utils/validation.js';

const router = Router();

// Toutes les routes /internal/admin/* requièrent le secret de l'admin-service.
router.use(fromAdminService);

// ── GESTION DES UTILISATEURS ──────────────────────────────────────────────────

/**
 * GET /internal/admin/users
 * Liste paginée des utilisateurs avec leurs rôles.
 * Paramètres query : search (optionnel), page (défaut 1), limit (défaut 10).
 */
router.get(
    '/users',
    asyncHandler(async (req, res) => {
        const params = {
            search: req.query.search || null,
            page: parseInt(req.query.page, 10) || 1,
            limit: parseInt(req.query.limit, 10) || 10,
        };

        const result = await usersService.listAllUsers(params);

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: result,
        });
    })
);

/**
 * GET /internal/admin/users/count
 * Nombre total d'utilisateurs enregistrés.
 * Déclaré AVANT /:id pour ne pas être capturé comme paramètre.
 */
router.get(
    '/users/count',
    asyncHandler(async (req, res) => {
        const count = await usersRepo.count();

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: { count },
        });
    })
);

/**
 * PATCH /internal/admin/users/:id/privileges
 * Met à jour le rôle et/ou le statut actif d'un utilisateur.
 * Les gardes métier (anti-auto-modification, anti-suppression d'admin)
 * sont centralisées dans usersService.updatePrivileges.
 */
router.patch(
    '/users/:id/privileges',
    asyncHandler(async (req, res) => {
        const { id } = req.params;
        const { role, isActive, adminId } = req.body;

        validateUUID(id, 'userId');

        if (!adminId) {
            throw new ValidationError('Le champ adminId est requis');
        }

        validateUUID(adminId, 'adminId');

        const updated = await usersService.updatePrivileges(id, { role, isActive }, adminId);

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: { user: updated },
        });
    })
);

/**
 * DELETE /internal/admin/users/:id
 * Supprime un compte utilisateur.
 * Les tables liées (user_roles, refresh_tokens) sont nettoyées via ON DELETE CASCADE.
 */
router.delete(
    '/users/:id',
    asyncHandler(async (req, res) => {
        const { id } = req.params;
        const { adminId } = req.body;

        validateUUID(id, 'userId');

        if (!adminId) {
            throw new ValidationError('Le champ adminId est requis');
        }

        validateUUID(adminId, 'adminId');

        await usersService.deleteUser(id, adminId);

        res.status(HTTP_STATUS.NO_CONTENT).send();
    })
);

// ── DÉCLENCHEURS DE CRON ─────────────────────────────────────────────────────

/**
 * POST /internal/admin/crons/sessions-cleanup
 * Supprime les refresh tokens expirés via la fonction SQL `cleanup_expired_tokens()`.
 * Appelé par le cron sessions-cleanup de l'admin-service (0 3 * * *).
 */
router.post(
    '/crons/sessions-cleanup',
    asyncHandler(async (req, res) => {
        const result = await sessionsCleanupJob.execute();

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: result,
        });
    })
);

export default router;
