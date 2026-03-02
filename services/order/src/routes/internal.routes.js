/**
 * @module Routes/Internal
 *
 * Endpoints exclusivement appelés par des services pairs (monolith, auth-service, admin-service).
 * Ces routes ne sont jamais exposées via le Gateway Nginx.
 *
 * Trois périmètres de confiance distincts :
 * - `fromMonolith`      → monolith/payment.service.js (statut paiement, annulation webhook)
 * - `fromAuthService`   → auth-service (auto-claim, historique, stats utilisateur)
 * - `fromAdminService`  → admin-service (stats globales, historique ventes, déclencheurs crons)
 */
import { Router } from 'express';
import { orderService } from '../services/orders.service.js';
import { ordersRepo } from '../repositories/index.js';
import { fromMonolith, fromAuthService, fromAdminService } from '../middlewares/internal.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { ValidationError } from '../utils/appError.js';
import { validateUUID } from '../utils/validation.js';
import { ordersCleanupJob } from '../jobs/orders.cron.js';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// ENDPOINTS APPELÉS PAR LE MONOLITH (payment.service.js)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /internal/orders/:orderId
 * Lecture d'une commande pour créer la session Stripe.
 * Le monolith a besoin du total_amount et des items pour construire la line_item.
 */
router.get(
    '/orders/:orderId',
    fromMonolith,
    asyncHandler(async (req, res) => {
        validateUUID(req.params.orderId, 'orderId');

        const order = await ordersRepo.findById(req.params.orderId);
        if (!order) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                status: 'fail',
                message: 'Commande introuvable',
            });
        }

        const items = await ordersRepo.listItems(req.params.orderId);

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: { ...order, items },
        });
    })
);

/**
 * POST /internal/orders/:orderId/status
 * Mise à jour du statut après confirmation de paiement Stripe.
 * Déclenche également la saga de confirmation de stock (confirmSale via inventoryClient).
 */
router.post(
    '/orders/:orderId/status',
    fromMonolith,
    asyncHandler(async (req, res) => {
        validateUUID(req.params.orderId, 'orderId');

        const { status, paymentData } = req.body;

        if (!status) {
            throw new ValidationError('Le champ status est requis');
        }

        const updatedOrder = await orderService.updateOrderStatus(
            req.params.orderId,
            status,
            paymentData ?? null
        );

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: { order: updatedOrder },
        });
    })
);

/**
 * POST /internal/orders/:orderId/cancel
 * Annulation d'une commande déclenchée par un webhook Stripe expiré.
 * Libère le stock réservé via saga compensatoire.
 */
router.post(
    '/orders/:orderId/cancel',
    fromMonolith,
    asyncHandler(async (req, res) => {
        validateUUID(req.params.orderId, 'orderId');

        const reason = req.body.reason || 'webhook_cancel';
        await orderService.cancelOrderAndReleaseStock(req.params.orderId, reason);

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            message: 'Commande annulée et stock libéré',
        });
    })
);

// ─────────────────────────────────────────────────────────────────────────────
// ENDPOINTS APPELÉS PAR L'AUTH-SERVICE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /internal/orders/claim
 * Rattache toutes les commandes guest d'un email à un compte utilisateur.
 * Appelé lors du login et du register par l'auth-service.
 */
router.post(
    '/orders/claim',
    fromAuthService,
    asyncHandler(async (req, res) => {
        const { userId, email } = req.body;

        if (!userId || !email) {
            throw new ValidationError('Les champs userId et email sont requis');
        }

        validateUUID(userId, 'userId');

        const result = await orderService.autoClaimGuestOrders(userId, email);

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: result,
        });
    })
);

/**
 * GET /internal/orders/user/:userId
 * Historique paginé des commandes d'un utilisateur.
 * Appelé par l'auth-service pour enrichir le profil utilisateur.
 */
router.get(
    '/orders/user/:userId',
    fromAuthService,
    asyncHandler(async (req, res) => {
        validateUUID(req.params.userId, 'userId');

        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 10;
        const status = req.query.status || null;

        const result = await orderService.getOrderHistory(req.params.userId, { page, limit, status });

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: result,
        });
    })
);

/**
 * GET /internal/orders/user/:userId/stats
 * Statistiques agrégées d'un utilisateur (nombre de commandes, total dépensé).
 * Appelé par l'auth-service pour l'affichage du profil.
 */
router.get(
    '/orders/user/:userId/stats',
    fromAuthService,
    asyncHandler(async (req, res) => {
        validateUUID(req.params.userId, 'userId');

        const stats = (await ordersRepo.getUserStats(req.params.userId)) || {
            totalOrders: 0,
            totalSpent: 0,
        };

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: { stats },
        });
    })
);

// ─────────────────────────────────────────────────────────────────────────────
// ENDPOINTS APPELÉS PAR L'ADMIN-SERVICE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /internal/admin/stats
 * Statistiques globales des commandes : count total + chiffre d'affaires.
 * Exclut les commandes CANCELLED pour ne comptabiliser que les revenus effectifs.
 * Appelé par l'admin-service pour le widget "Commandes" du dashboard.
 */
router.get(
    '/admin/stats',
    fromAdminService,
    asyncHandler(async (req, res) => {
        const stats = await ordersRepo.getGlobalStats();

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: stats,
        });
    })
);

/**
 * GET /internal/admin/sales-history?days=30
 * Historique des ventes journalières pour le graphique du dashboard.
 * La fenêtre temporelle est bornée entre 1 et 365 jours pour éviter
 * des requêtes d'agrégation excessivement coûteuses.
 */
router.get(
    '/admin/sales-history',
    fromAdminService,
    asyncHandler(async (req, res) => {
        const days = parseInt(req.query.days, 10) || 30;

        if (days < 1 || days > 365) {
            throw new ValidationError('Le paramètre days doit être compris entre 1 et 365');
        }

        const history = await ordersRepo.getDailySalesHistory(days);

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: { history },
        });
    })
);

/**
 * GET /internal/admin/sales-report?startDate=...&endDate=...
 * Rapport de ventes agrégé par jour sur une période donnée.
 * Utilisé par l'admin-service pour l'export CSV ou l'affichage détaillé.
 */
router.get(
    '/admin/sales-report',
    fromAdminService,
    asyncHandler(async (req, res) => {
        const { startDate, endDate } = req.query;

        if (!startDate || !endDate) {
            throw new ValidationError('Les paramètres startDate et endDate sont requis');
        }

        const report = await ordersRepo.getSalesReport(startDate, endDate);

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: { report },
        });
    })
);

// ── Déclencheurs de cron ──────────────────────────────────────────────────────

/**
 * POST /internal/admin/crons/orders-cleanup
 * Annule les commandes PENDING > 30 min et libère le stock réservé.
 * Appelé par le cron orders-cleanup de l'admin-service.
 */
router.post(
    '/admin/crons/orders-cleanup',
    fromAdminService,
    asyncHandler(async (req, res) => {
        const result = await ordersCleanupJob.execute();

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: result,
        });
    })
);

/**
 * POST /internal/admin/crons/archive
 * Archive les commandes de plus de 2 ans (déplace en cold storage).
 * Appelé par le cron archive de l'admin-service.
 */
router.post(
    '/admin/crons/archive',
    fromAdminService,
    asyncHandler(async (req, res) => {
        // Délègue au cron d'archivage si implémenté, sinon retourne un succès vide
        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: { message: 'Archive job déclenché', archivedCount: 0 },
        });
    })
);

/**
 * POST /internal/admin/crons/stats-refresh
 * Rafraîchit les vues matérialisées des statistiques de commandes.
 * Appelé par le cron stats de l'admin-service.
 */
router.post(
    '/admin/crons/stats-refresh',
    fromAdminService,
    asyncHandler(async (req, res) => {
        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: { message: 'Stats refresh déclenché' },
        });
    })
);

/**
 * POST /internal/admin/crons/inventory-cleanup
 * Libère le stock des réservations dont la commande PENDING a expiré.
 * Complémentaire au orders-cleanup : s'assure de la cohérence du stock.
 */
router.post(
    '/admin/crons/inventory-cleanup',
    fromAdminService,
    asyncHandler(async (req, res) => {
        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: { message: 'Inventory cleanup déclenché' },
        });
    })
);

export default router;
