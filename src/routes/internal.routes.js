/**
 * @module Routes/Internal
 *
 * Endpoints du monolith exclusivement appelés par l'order-service.
 * Non exposés via le Gateway Nginx — accessibles uniquement en réseau interne.
 *
 * Protégés par `X-Internal-Secret` validé par `internal.middleware.js`.
 *
 * Périmètre :
 * - /internal/inventory/* → opérations de stock (reserve, release, confirm)
 * - /internal/products/*  → données produit sans effet de bord (lecture seule)
 */
import { Router } from 'express';
import { inventoryRepo } from '../repositories/index.js';
import { productsRepo } from '../repositories/index.js';
import { fromOrderService } from '../middlewares/internal.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { ValidationError } from '../utils/appError.js';
import { pgPool } from '../config/database.js';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// INVENTORY — opérations de stock
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /internal/inventory/reserve
 * Réserve du stock pour un article en cours de commande.
 * Retourne price et weight pour le calcul des totaux côté order-service.
 */
router.post(
    '/inventory/reserve',
    fromOrderService,
    asyncHandler(async (req, res) => {
        const { variantId, quantity } = req.body;

        if (!variantId || !quantity) {
            throw new ValidationError('Les champs variantId et quantity sont requis');
        }

        const inventoryEntry = await inventoryRepo.reserve(variantId, quantity);

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: {
                variantId,
                price: inventoryEntry.price,
                weight: inventoryEntry.weight || 0.5,
            },
        });
    })
);

/**
 * POST /internal/inventory/release
 * Libère du stock réservé (annulation ou expiration de session Stripe).
 */
router.post(
    '/inventory/release',
    fromOrderService,
    asyncHandler(async (req, res) => {
        const { variantId, quantity } = req.body;

        if (!variantId || !quantity) {
            throw new ValidationError('Les champs variantId et quantity sont requis');
        }

        await inventoryRepo.release(variantId, quantity);

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            message: 'Stock libéré',
        });
    })
);

/**
 * POST /internal/inventory/confirm
 * Confirme la sortie définitive du stock après paiement validé.
 * Le stock réservé est décrémenté sans restaurer le disponible.
 */
router.post(
    '/inventory/confirm',
    fromOrderService,
    asyncHandler(async (req, res) => {
        const { variantId, quantity } = req.body;

        if (!variantId || !quantity) {
            throw new ValidationError('Les champs variantId et quantity sont requis');
        }

        await inventoryRepo.confirmSale(variantId, quantity);

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            message: 'Vente confirmée',
        });
    })
);

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCTS — lecture de données produit (sans effet de bord)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /internal/products/variant/:variantId
 * Retourne les données d'une variante (prix de base, poids, slug).
 * Utilisé par l'order-service pour la prévisualisation de commande.
 */
router.get(
    '/products/variant/:variantId',
    fromOrderService,
    asyncHandler(async (req, res) => {
        const { variantId } = req.params;

        const variant = await productsRepo.findVariantById(variantId);

        if (!variant) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                status: 'fail',
                message: 'Variante introuvable',
            });
        }

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: {
                id: variant.id,
                price: variant.price,
                weight: variant.weight || 0.5,
                productId: variant.productId,
            },
        });
    })
);

/**
 * GET /internal/products/variant/:variantId/promo
 * Retourne le prix effectif en tenant compte des promotions actives.
 * Retourne hasPromotion=false si aucune promotion n'est active — jamais d'erreur.
 */
router.get(
    '/products/variant/:variantId/promo',
    fromOrderService,
    asyncHandler(async (req, res) => {
        const { variantId } = req.params;

        const promotionData = await productsRepo.findActivePromotionPrice(variantId, pgPool);

        if (!promotionData) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                status: 'fail',
                message: 'Variante introuvable',
            });
        }

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: {
                basePrice: promotionData.basePrice ?? promotionData.base_price,
                effectivePrice: promotionData.effectivePrice ?? promotionData.effective_price,
                hasPromotion: promotionData.hasPromotion ?? promotionData.has_promotion ?? false,
            },
        });
    })
);

export default router;