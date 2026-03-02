/**
 * @module Controller/Order
 *
 * Gère le cycle de vie des commandes avec calcul automatique des taxes et frais.
 * Supporte les modes authentifié et guest (accès public avec vérification email).
 */
import { orderService } from '../services/orders.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { ValidationError } from '../utils/appError.js';

class OrderController {
    /**
     * POST /api/v1/orders/preview
     * Prévisualise le montant total avec ventilation détaillée.
     */
    previewTotal = asyncHandler(async (req, res) => {
        const {
            items,
            shippingMethod = 'STANDARD',
            shippingCountry = 'France',
            taxCategory = 'standard',
        } = req.body;

        const preview = await orderService.previewOrderTotal(req.user?.id ?? null, {
            items,
            shippingMethod,
            shippingCountry,
            taxCategory,
        });

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: { preview },
        });
    });

    /**
     * POST /api/v1/orders/checkout
     * Validation de commande avec calcul automatique des taxes et frais.
     */
    checkout = asyncHandler(async (req, res) => {
        const {
            items,
            shippingAddress,
            shippingMethod = 'STANDARD',
            shippingCountry = 'France',
            taxCategory = 'standard',
        } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            throw new ValidationError('Le panier est vide');
        }

        if (!shippingAddress) {
            throw new ValidationError('Adresse de livraison manquante');
        }

        const order = await orderService.createOrderFromCart(req.user?.id ?? null, {
            items,
            shippingAddress,
            shippingMethod,
            shippingCountry,
            taxCategory,
        });

        res.status(HTTP_STATUS.CREATED).json({
            status: 'success',
            message: 'Commande créée avec succès',
            data: {
                order,
                isGuestCheckout: !req.user,
            },
        });
    });

    /**
     * POST /api/v1/orders/:orderId/cancel
     * Annule une commande PENDING et libère le stock réservé.
     * Accessible en mode guest (avec ?email=) et authentifié.
     */
    cancelOrder = asyncHandler(async (req, res) => {
        const { orderId } = req.params;
        const email = req.query.email || req.body.email || null;

        const result = await orderService.cancelPendingOrder(orderId, req.user ?? null, email);

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            message: result.message,
        });
    });

    /**
     * POST /api/v1/orders/track-guest
     * Suivi de commande pour les guests (non-authentifiés).
     */
    trackGuestOrder = asyncHandler(async (req, res) => {
        const { orderNumber, email } = req.body;

        const order = await orderService.trackOrderGuest(orderNumber, email);

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: {
                order,
                isGuest: true,
                conversionBannerEnabled: true,
            },
        });
    });

    /**
     * POST /api/v1/orders/:orderId/claim
     * Rattache une commande guest à un compte utilisateur authentifié.
     */
    claimOrder = asyncHandler(async (req, res) => {
        const { orderId } = req.params;
        const { email } = req.body;

        const claimedOrder = await orderService.claimGuestOrder(orderId, req.user.id, email);

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            message: 'Commande rattachée à votre compte avec succès',
            data: { order: claimedOrder },
        });
    });

    /**
     * GET /api/v1/orders/:orderId
     * Mode authentifié : vérifie la propriété via req.user.
     * Mode guest : requiert ?email= pour vérification timing-safe côté service.
     */
    getOrderDetail = asyncHandler(async (req, res) => {
        const { orderId } = req.params;
        const { email } = req.query;

        if (req.user) {
            const order = await orderService.getOrderDetails(orderId, req.user);
            return res.status(HTTP_STATUS.OK).json({
                status: 'success',
                data: { order, isGuest: false },
            });
        }

        if (!email || email.trim() === '') {
            throw new ValidationError('Email requis pour accéder aux détails de la commande');
        }

        const order = await orderService.getOrderDetailsGuest(orderId, email);

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: {
                order,
                isGuest: true,
                conversionBannerEnabled: true,
            },
        });
    });

    /**
     * GET /api/v1/orders/my-orders
     * Historique paginé des commandes de l'utilisateur connecté.
     *
     * Délègue à getOrderHistory (pagination réelle) plutôt qu'à getUserOrders
     * qui chargeait toutes les commandes sans paginer, rendant la pagination UI
     * inopérante au-delà de 10 commandes.
     */
    getMyOrders = asyncHandler(async (req, res) => {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 10;
        const status = req.query.status || null;

        const result = await orderService.getOrderHistory(req.user.id, { page, limit, status });

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: {
                orders: result.orders,
                pagination: result.pagination,
            },
        });
    });

    /**
     * GET /api/v1/orders
     * ADMINISTRATION : Liste toutes les commandes avec filtres et recherche.
     */
    getAllOrders = asyncHandler(async (req, res) => {
        const queryParams = {
            status: req.query.status || null,
            userId: req.query.userId || null,
            search: req.query.search || null,
            page: parseInt(req.query.page, 10) || 1,
            limit: parseInt(req.query.limit, 10) || 20,
        };

        const result = await orderService.listAllOrders(queryParams);

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: {
                orders: result.orders || result.data || [],
                pagination: result.pagination || { page: 1, totalPages: 1, total: 0 },
            },
        });
    });

    /**
     * PATCH /api/v1/orders/:orderId/status
     * ADMINISTRATION : Met à jour le statut d'une commande.
     */
    updateStatus = asyncHandler(async (req, res) => {
        const { orderId } = req.params;
        const { status } = req.body;

        const updatedOrder = await orderService.updateOrderStatus(orderId, status);

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            message: `Statut de la commande mis à jour : ${status}`,
            data: { order: updatedOrder },
        });
    });
}

export const orderController = new OrderController();