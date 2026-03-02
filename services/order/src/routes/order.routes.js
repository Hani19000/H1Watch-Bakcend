/**
 * @module Routes/Orders
 *
 * ORDRE DES ROUTES (critique) :
 * Express évalue les routes dans l'ordre de déclaration.
 * Les routes statiques (/preview, /checkout, /track-guest, /my-orders)
 * sont déclarées AVANT les routes paramétriques (/:orderId) pour ne pas
 * être capturées comme valeurs de paramètre.
 */
import { Router } from 'express';
import { orderController } from '../controllers/order.controller.js';
import { protect } from '../middlewares/auth.middleware.js';
import { optionalAuth } from '../middlewares/optionalAuth.middleware.js';
import { restrictTo } from '../middlewares/role.middleware.js';
import { trackingGuestLimiter } from '../config/security.js';
import { validateRequired, validateEmail, validateUUID } from '../utils/validation.js';
import { ValidationError } from '../utils/appError.js';

const router = Router();

// Format : ORD-{4 chiffres année}-{1 à 10 chiffres séquentiels}
// Aligné avec le regex du repository (ordersRepo.findByOrderNumberAndEmail)
// et la génération effective des order_number en base (pas de zéro-padding).
const ORDER_NUMBER_REGEX = /^ORD-\d{4}-\d{1,10}$/;

// ─────────────────────────────────────────────────────────────────────
// 1. ROUTES STATIQUES — GUEST / OPTIONNEL
// ─────────────────────────────────────────────────────────────────────

router.post('/preview', optionalAuth, orderController.previewTotal);

router.post('/checkout', optionalAuth, orderController.checkout);

/**
 * POST /api/v1/orders/track-guest
 * Suivi de commande par numéro + email (guests uniquement).
 * Rate limiting strict pour prévenir l'énumération de commandes.
 */
router.post(
    '/track-guest',
    trackingGuestLimiter,
    (req, _res, next) => {
        validateRequired(req.body, ['orderNumber', 'email']);
        validateEmail(req.body.email);

        if (!ORDER_NUMBER_REGEX.test(req.body.orderNumber)) {
            throw new ValidationError('Format de numéro de commande invalide');
        }

        next();
    },
    orderController.trackGuestOrder
);

// ─────────────────────────────────────────────────────────────────────
// 2. ROUTES STATIQUES — AUTHENTIFIÉES
// Déclarées avant /:orderId pour ne pas être capturées comme UUID
// ─────────────────────────────────────────────────────────────────────

router.get('/my-orders', protect, orderController.getMyOrders);

// ─────────────────────────────────────────────────────────────────────
// 3. ADMINISTRATION
// ─────────────────────────────────────────────────────────────────────

router.get('/', protect, restrictTo('ADMIN'), orderController.getAllOrders);

// ─────────────────────────────────────────────────────────────────────
// 4. ROUTES PARAMÉTRIQUES /:orderId — en dernier
// ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/orders/:orderId
 * Mode authentifié : vérifie la propriété via req.user.
 * Mode guest : requiert ?email= pour vérification timing-safe côté service.
 * trackingGuestLimiter protège les deux modes contre l'énumération.
 */
router.get(
    '/:orderId',
    trackingGuestLimiter,
    optionalAuth,
    (req, _res, next) => {
        validateUUID(req.params.orderId, 'orderId');
        next();
    },
    orderController.getOrderDetail
);

/**
 * POST /api/v1/orders/:orderId/cancel
 * Annule une commande PENDING et libère le stock réservé.
 * Accessible en mode guest (avec ?email= ou body.email) et authentifié.
 */
router.post(
    '/:orderId/cancel',
    optionalAuth,
    (req, _res, next) => {
        validateUUID(req.params.orderId, 'orderId');
        next();
    },
    orderController.cancelOrder
);

/**
 * POST /api/v1/orders/:orderId/claim
 * Rattache une commande guest au compte de l'utilisateur connecté.
 * Dès que le claim réussit, la commande devient invisible pour tout accès guest.
 */
router.post(
    '/:orderId/claim',
    protect,
    (req, _res, next) => {
        validateRequired(req.body, ['email']);
        validateEmail(req.body.email);
        validateUUID(req.params.orderId, 'orderId');
        next();
    },
    orderController.claimOrder
);

/**
 * PATCH /api/v1/orders/:orderId/status
 * ADMINISTRATION : mise à jour du statut d'une commande.
 */
router.patch('/:orderId/status', protect, restrictTo('ADMIN'), orderController.updateStatus);

export default router;