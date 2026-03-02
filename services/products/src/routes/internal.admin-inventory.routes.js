/**
 * @module Routes/Internal/Admin/Inventory — product-service
 *
 * Endpoints d'inventaire réservés à l'admin-service.
 * Protégés par INTERNAL_ADMIN_SECRET via fromAdminService.
 *
 * Ces routes ne transitent JAMAIS par le Gateway Nginx.
 * Elles sont appelées exclusivement en réseau interne Render,
 * depuis l'admin-service via productClient.
 *
 * Pourquoi un fichier séparé de internal.routes.js ?
 * Le secret entrant est INTERNAL_ADMIN_SECRET, distinct de INTERNAL_PRODUCT_SECRET
 * utilisé par order-service, cart-service et payment-service.
 * Des secrets distincts isolent les périmètres de confiance :
 * un secret compromis dans un service ne donne pas accès à l'autre périmètre.
 */
import { Router } from 'express';
import { fromAdminService } from '../middleware/internal.middleware.js';
import { inventoryService } from '../services/inventory.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { ValidationError } from '../utils/appError.js';

const router = Router();

/**
 * GET /internal/admin/inventory
 * Liste complète de l'inventaire avec filtres et pagination.
 * Délègue à inventoryService.getAllInventory — aucune logique métier dupliquée.
 */
router.get(
    '/inventory',
    fromAdminService,
    asyncHandler(async (req, res) => {
        const result = await inventoryService.getAllInventory(req.query);

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: result,
        });
    })
);

/**
 * GET /internal/admin/inventory/alerts
 * Articles dont le stock est sous le seuil d'alerte.
 * Déclaré avant /inventory/:variantId pour éviter qu'Express
 * interprète "alerts" comme une valeur de paramètre.
 */
router.get(
    '/inventory/alerts',
    fromAdminService,
    asyncHandler(async (req, res) => {
        const alerts = await inventoryService.getLowStockAlerts();

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            results: alerts.length,
            data: { alerts },
        });
    })
);

/**
 * PATCH /internal/admin/inventory/:variantId/adjust
 * Ajustement manuel du stock : réception, perte, correction d'inventaire.
 */
router.patch(
    '/inventory/:variantId/adjust',
    fromAdminService,
    asyncHandler(async (req, res) => {
        const { variantId } = req.params;
        const { quantity, reason } = req.body;

        if (quantity === undefined || quantity === null) {
            throw new ValidationError('Le champ quantity est requis');
        }

        const updatedStock = await inventoryService.adjustStock(variantId, quantity, reason);

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            message: 'Stock mis à jour avec succès',
            data: { stock: updatedStock },
        });
    })
);

/**
 * PATCH /internal/admin/inventory/restock/:variantId
 * Réapprovisionnement suite à une réception de marchandise.
 */
router.patch(
    '/inventory/restock/:variantId',
    fromAdminService,
    asyncHandler(async (req, res) => {
        const { variantId } = req.params;
        const { quantity } = req.body;

        if (!quantity) {
            throw new ValidationError('Le champ quantity est requis');
        }

        const stock = await inventoryService.restockVariant(variantId, parseInt(quantity, 10));

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            message: 'Stock réapprovisionné avec succès',
            data: { stock },
        });
    })
);

export default router;