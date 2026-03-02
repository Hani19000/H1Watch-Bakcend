/**
 * @module Routes/Admin
 *
 * Routes réservées aux administrateurs.
 * protect + requireAdmin sont appliqués globalement via router.use()
 * pour garantir qu'aucune route ne peut être exposée par erreur sans auth.
 */
import { Router } from 'express';
import { protect, requireAdmin } from '../middlewares/auth.middleware.js';
import { dashboardController } from '../controllers/dashboard.controller.js';
import { usersController } from '../controllers/users.controller.js';
import { cronsController } from '../controllers/crons.controller.js';

const router = Router();

// Tous les handlers de ce router exigent un JWT valide + rôle ADMIN
router.use(protect);
router.use(requireAdmin);

// ── Statistiques & Dashboard ──────────────────────────────────────────────────

router.get('/stats', dashboardController.getStats);
router.get('/sales-history', dashboardController.getSalesHistory);
router.get('/sales-report', dashboardController.getSalesReport);

// Invalidation manuelle du cache — utile après une opération batch
router.post('/cache/invalidate', dashboardController.invalidateCache);

// ── Gestion des utilisateurs ──────────────────────────────────────────────────
// Opérations déléguées à l'auth-service via authClient.

router.get('/users', usersController.listUsers);
router.patch('/users/:userId/privileges', usersController.updatePrivileges);
router.delete('/users/:userId', usersController.deleteUser);

// ── Gestion des crons ─────────────────────────────────────────────────────────

router.get('/crons', cronsController.listJobs);
router.post('/crons/:name/execute', cronsController.executeJob);
router.post('/crons/:name/stop', cronsController.stopJob);
router.post('/crons/:name/restart', cronsController.restartJob);

export default router;
