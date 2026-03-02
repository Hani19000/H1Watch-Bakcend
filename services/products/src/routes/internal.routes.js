/**
 * @module Routes/Internal — product-service
 *
 * Endpoints exclusivement appelés par les services pairs.
 * Non exposés via le Gateway Nginx.
 *
 * Deux périmètres de confiance distincts :
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ fromInternalService (INTERNAL_PRODUCT_SECRET)                            │
 * │   GET  /internal/variants/:variantId        → order-service + cart       │
 * │   GET  /internal/variants/:variantId/promo  → order-service              │
 * │   GET  /internal/inventory/:variantId        → cart-service              │
 * │   POST /internal/inventory/reserve           → order-service             │
 * │   POST /internal/inventory/release           → order-service             │
 * │   POST /internal/inventory/confirm           → order-service             │
 * ├──────────────────────────────────────────────────────────────────────────┤
 * │ fromAdminService (INTERNAL_ADMIN_SECRET)                                 │
 * │   GET  /internal/stats                       → admin-service             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Les deux secrets sont distincts : un secret compromis ne donne pas accès
 * au périmètre de l'autre service.
 */
import { Router } from 'express';
import { productsRepo, inventoryRepo } from '../repositories/index.js';
import { fromInternalService, fromAdminService } from '../middleware/internal.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { ValidationError } from '../utils/appError.js';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// VARIANTS — lecture de données produit (sans effet de bord)
// Appelants : order-service, cart-service
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /internal/variants/:variantId
 * Données brutes d'une variante : prix, poids, productId.
 */
router.get(
    '/variants/:variantId',
    fromInternalService,
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
                sku: variant.sku,
                price: parseFloat(variant.price),
                weight: parseFloat(variant.attributes?.weight ?? 0.5),
                productId: variant.productId,
                attributes: variant.attributes,
            },
        });
    })
);

/**
 * GET /internal/variants/:variantId/promo
 * Prix effectif avec promotions actives — snapshot au moment du checkout.
 */
router.get(
    '/variants/:variantId/promo',
    fromInternalService,
    asyncHandler(async (req, res) => {
        const { variantId } = req.params;

        const promotionData = await productsRepo.findActivePromotionPrice(variantId);

        if (!promotionData) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                status: 'fail',
                message: 'Variante introuvable',
            });
        }

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: {
                basePrice: promotionData.basePrice,
                effectivePrice: promotionData.effectivePrice,
                hasPromotion: promotionData.hasPromotion,
            },
        });
    })
);

// ─────────────────────────────────────────────────────────────────────────────
// INVENTORY — opérations de stock avec effet de bord
// Appelants : order-service, cart-service
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /internal/inventory/:variantId
 * Stock disponible d'une variante — lecture sans cache (source de vérité DB).
 */
router.get(
    '/inventory/:variantId',
    fromInternalService,
    asyncHandler(async (req, res) => {
        const { variantId } = req.params;

        const inventory = await inventoryRepo.findByVariantId(variantId);

        if (!inventory) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                status: 'fail',
                message: 'Inventaire introuvable pour cette variante',
            });
        }

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: {
                variantId,
                availableStock: inventory.availableStock,
                reservedStock: inventory.reservedStock,
            },
        });
    })
);

/**
 * POST /internal/inventory/reserve
 * Déplace du stock de "disponible" vers "réservé" lors du checkout.
 * Atomique : échoue sans effet si available_stock < quantity.
 */
router.post(
    '/inventory/reserve',
    fromInternalService,
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
                price: parseFloat(inventoryEntry.price),
                weight: 0.5,
            },
        });
    })
);

/**
 * POST /internal/inventory/release
 * Restitue du stock réservé vers le disponible.
 * Appelé lors d'une annulation ou d'une session Stripe expirée.
 */
router.post(
    '/inventory/release',
    fromInternalService,
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
 * Le stock réservé est décrémenté définitivement — la marchandise est vendue.
 */
router.post(
    '/inventory/confirm',
    fromInternalService,
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
// STATS — agrégats pour le dashboard admin
// Appelant : admin-service uniquement (secret distinct)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /internal/stats
 * Compteurs produit pour le widget dashboard admin.
 * Protégé par INTERNAL_ADMIN_SECRET — isolé du périmètre order/cart/payment.
 */
router.get(
    '/stats',
    fromAdminService,
    asyncHandler(async (req, res) => {
        const [totalProducts, lowStockCount, inventoryStats] = await Promise.all([
            productsRepo.count(),
            productsRepo.countLowStock(5),
            inventoryRepo.getStats(),
        ]);

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: {
                totalProducts,
                lowStockCount,
                inventory: inventoryStats,
            },
        });
    })
);

export default router;
