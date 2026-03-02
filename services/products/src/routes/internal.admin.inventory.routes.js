/**
 * @module Routes/Internal/Admin/Inventory — product-service
 *
 * Endpoints d'inventaire réservés à l'admin-service.
 * Protégés par INTERNAL_ADMIN_SECRET via fromAdminService — jamais exposés par le Gateway.
 *
 * Pourquoi ce fichier plutôt que de laisser le frontend appeler /inventory directement ?
 * Les routes publiques /inventory exigent un JWT Bearer valide (protect + restrictTo('ADMIN')).
 * Faire valider le JWT par le product-service crée un couplage sur JWT_ACCESS_SECRET et
 * oblige à synchroniser ce secret entre deux services distincts.
 * En passant par l'admin-service (qui valide lui-même le JWT), le product-service
 * n'a besoin que de son secret interne — séparation de responsabilité respectée.
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
 * Articles en stock bas — seuil défini dans inventoryService.
 * Exposé ici pour éviter d'exiger le JWT du frontend dans le product-service.
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
 * Ajustement manuel du stock (réception, perte, correction d'inventaire).
 * La logique d'ajustement reste dans inventoryService — ce handler ne fait que déléguer.
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