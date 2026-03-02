/**
 * @module Routes/Internal
 *
 * Endpoints du cart-service réservés aux services pairs.
 * Non exposés via le Gateway Nginx (bloqué en amont par location /internal/*).
 *
 * Protégés par X-Internal-Secret → fromInternalService.
 *
 * Périmètre :
 * ┌───────────────────────────────────────────────────────────────┐
 * │ POST /internal/cart/merge   → auth-service (après login)      │
 * │ GET  /internal/cart/:userId → order-service (checkout)        │
 * │ DELETE /internal/cart/:userId → order-service (post-checkout) │
 * └───────────────────────────────────────────────────────────────┘
 */
import { Router } from 'express';
import { cartService } from '../services/cart.service.js';
import { cartsRepo } from '../repositories/index.js';
import { fromInternalService } from '../middlewares/internal.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { ValidationError } from '../utils/appError.js';

const router = Router();

router.use(fromInternalService);

/**
 * POST /internal/cart/merge
 * Fusionne le panier guest dans le panier de l'utilisateur qui vient de se connecter.
 * Appelé par l'auth-service ou le frontend après une connexion réussie.
 */
router.post(
    '/merge',
    asyncHandler(async (req, res) => {
        const { guestCartId, userId } = req.body;

        if (!guestCartId || !userId) {
            throw new ValidationError('guestCartId et userId sont requis');
        }

        const mergedCart = await cartService.mergeCarts(guestCartId, userId);

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: { cart: mergedCart },
        });
    })
);

/**
 * GET /internal/cart/:userId
 * Retourne le panier complet enrichi pour le checkout dans l'order-service.
 * Permet à l'order-service de lire les articles sans passer par le Gateway.
 */
router.get(
    '/:userId',
    asyncHandler(async (req, res) => {
        const { userId } = req.params;
        const cart = await cartService.getCartByUserId(userId);

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: { cart },
        });
    })
);

/**
 * DELETE /internal/cart/:userId
 * Vide le panier après un checkout réussi.
 * Appelé par l'order-service une fois la commande créée.
 */
router.delete(
    '/:userId',
    asyncHandler(async (req, res) => {
        const { userId } = req.params;
        await cartService.clearCartByUserId(userId);

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            message: 'Panier vidé',
        });
    })
);

export default router;
