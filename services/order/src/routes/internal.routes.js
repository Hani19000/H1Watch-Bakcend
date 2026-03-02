/**
 * @module Routes/Internal
 *
 * Endpoints exclusivement appelés par des services pairs (monolith, auth-service).
 * Ces routes ne sont jamais exposées via le Gateway Nginx.
 *
 * Deux périmètres de confiance distincts :
 * - `fromMonolith`     → payment.service.js (marquer PAID, annuler via webhook Stripe)
 * - `fromAuthService`  → auth.service.js (auto-claim, historique, stats)
 */
import { Router } from 'express';
import { orderService } from '../services/orders.service.js';
import { ordersRepo } from '../repositories/index.js';
import { fromMonolith, fromAuthService } from '../middlewares/internal.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { ValidationError } from '../utils/appError.js';
import { validateUUID } from '../utils/validation.js';

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
            totalSpent: 0
        };

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: { stats },
        });
    })
);

export default router;