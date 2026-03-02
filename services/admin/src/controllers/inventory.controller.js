/**
 * @module Controllers/Inventory
 *
 * Expose les opérations d'inventaire pour le tableau de bord administrateur.
 * Ce contrôleur est un proxy HTTP vers le product-service via productClient.
 * La logique métier (seuils d'alerte, ajustements de stock) reste dans le product-service.
 */
import { productClient } from '../clients/product.client.js';

class InventoryController {

    /**
     * GET /api/v1/admin/inventory
     * Liste complète de l'inventaire avec filtres et pagination.
     * Les paramètres de requête (search, page, limit) sont transmis tels quels au product-service.
     */
    getAllInventory = async (req, res, next) => {
        try {
            const result = await productClient.getAllInventory(req.query);
            res.status(200).json({ status: 'success', data: result });
        } catch (err) {
            next(err);
        }
    };

    /**
     * GET /api/v1/admin/inventory/alerts
     * Articles dont le stock est sous le seuil d'alerte.
     * Permet de déclencher les réassorts avant d'atteindre la rupture.
     */
    getLowStockAlerts = async (req, res, next) => {
        try {
            const result = await productClient.getLowStockAlerts();
            res.status(200).json({ status: 'success', data: result });
        } catch (err) {
            next(err);
        }
    };

    /**
     * PATCH /api/v1/admin/inventory/:variantId/adjust
     * Ajustement manuel du stock : réception de marchandise, perte, correction d'inventaire.
     */
    adjustStock = async (req, res, next) => {
        try {
            const { variantId } = req.params;
            const result = await productClient.adjustStock(variantId, req.body);
            res.status(200).json({ status: 'success', data: result });
        } catch (err) {
            next(err);
        }
    };

    /**
     * PATCH /api/v1/admin/inventory/restock/:variantId
     * Réapprovisionnement d'une variante suite à une réception de marchandise.
     */
    restockVariant = async (req, res, next) => {
        try {
            const { variantId } = req.params;
            const result = await productClient.restockVariant(variantId, req.body);
            res.status(200).json({ status: 'success', data: result });
        } catch (err) {
            next(err);
        }
    };
}

export const inventoryController = new InventoryController();