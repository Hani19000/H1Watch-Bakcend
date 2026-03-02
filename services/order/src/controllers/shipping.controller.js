/**
 * @module Controller/Shipping
 * @service order-service
 *
 * Expose les calculs de frais de port et la gestion des expéditions via HTTP.
 *
 * APPARTENANCE — Pourquoi dans l'order-service :
 *   shippingService est déjà utilisé en interne par ordersService#_calculateTotals.
 *   Les expéditions (shipments) sont stockées dans le schéma "order" et référencent
 *   les commandes. L'order-service est le propriétaire naturel de ces données.
 *
 * SÉPARATION DES ROUTES :
 *   - Publiques (no auth)   : /calculate, /rates, /track/:orderId
 *     Nécessaires pour les guests (preview de frais avant création de compte).
 *   - Admin uniquement      : /shipments/:orderId (POST), /shipments/:shipmentId (PATCH)
 *     Gestion logistique réservée aux opérateurs.
 *
 *   NOTE sur le monolithe : les routes shipping nécessitaient protect sur toutes
 *   les routes. En microservice, /calculate et /track sont rendues publiques car
 *   les guests doivent voir les frais de port avant de passer commande.
 */
import { shippingService } from '../services/shipping.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { AppError } from '../utils/appError.js';

// Statuts valides pour une expédition — utilisés dans updateTracking.
// Centralisés ici pour éviter la duplication entre controller et service.
const ALLOWED_SHIPMENT_STATUSES = [
    'PREPARING',
    'SHIPPED',
    'IN_TRANSIT',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
    'FAILED',
    'RETURNED',
];

class ShippingController {
    /**
     * POST /api/v1/shipping/calculate
     * Calcule toutes les options de livraison disponibles pour un pays et un poids.
     * Retourne STANDARD, EXPRESS et RELAY (si disponibles) avec prix et délais estimés.
     *
     * PUBLIC — accessible en mode guest pour permettre la preview des frais
     * avant la création d'un compte ou d'une commande.
     *
     * @body { country: string, totalWeight: number, cartSubtotal?: number }
     * @example POST /api/v1/shipping/calculate
     * { "country": "France", "totalWeight": 1.5, "cartSubtotal": 45 }
     */
    calculateOptions = asyncHandler(async (req, res) => {
        const { country, totalWeight, cartSubtotal = 0 } = req.body;

        if (!country) {
            throw new AppError('Le champ country est requis', HTTP_STATUS.BAD_REQUEST);
        }

        if (totalWeight === undefined || totalWeight === null) {
            throw new AppError('Le champ totalWeight est requis', HTTP_STATUS.BAD_REQUEST);
        }

        if (typeof totalWeight !== 'number' || totalWeight < 0) {
            throw new AppError('Le poids doit être un nombre positif ou nul', HTTP_STATUS.BAD_REQUEST);
        }

        const options = await shippingService.getAvailableOptions(country, totalWeight, cartSubtotal);

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: { country, totalWeight, cartSubtotal, options },
        });
    });

    /**
     * POST /api/v1/shipping/rates
     * Estimation simple des frais (méthode legacy, conservée pour compatibilité).
     * Préférer /calculate pour les nouveaux développements.
     *
     * PUBLIC — même raison que /calculate.
     */
    getRates = asyncHandler(async (req, res) => {
        const { cartId, country } = req.body;

        if (!country) {
            throw new AppError('Le champ country est requis', HTTP_STATUS.BAD_REQUEST);
        }

        const rates = await shippingService.calculateRates(cartId, { country });

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: { rates },
        });
    });

    /**
     * GET /api/v1/shipping/track/:orderId
     * Récupère les informations de suivi d'une expédition.
     * Accessible publiquement : un client peut suivre sa commande sans compte.
     */
    getTracking = asyncHandler(async (req, res) => {
        const shipment = await shippingService.getShipmentByOrder(req.params.orderId);

        if (!shipment) {
            throw new AppError(
                'Aucune expédition trouvée pour cette commande',
                HTTP_STATUS.NOT_FOUND
            );
        }

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: { shipment },
        });
    });

    /**
     * POST /api/v1/shipping/shipments/:orderId
     * ADMINISTRATION — Crée une expédition pour une commande payée.
     * Génère automatiquement un numéro de suivi.
     * Seules les commandes au statut PAID peuvent être expédiées.
     */
    createShipment = asyncHandler(async (req, res) => {
        const { orderId } = req.params;
        const { carrier = 'COLISSIMO' } = req.body;

        const shipment = await shippingService.createShipment(orderId, carrier);

        res.status(HTTP_STATUS.CREATED).json({
            status: 'success',
            message: 'Expédition créée avec succès',
            data: { shipment },
        });
    });

    /**
     * PATCH /api/v1/shipping/shipments/:shipmentId
     * ADMINISTRATION — Met à jour le statut et la localisation d'une expédition.
     * Un statut DELIVERED déclenche automatiquement la mise à jour de la commande
     * vers le statut DELIVERED côté ordersRepo.
     */
    updateTracking = asyncHandler(async (req, res) => {
        const { shipmentId } = req.params;
        const { status, currentLocation = '' } = req.body;

        if (!status) {
            throw new AppError('Le champ status est requis', HTTP_STATUS.BAD_REQUEST);
        }

        if (!ALLOWED_SHIPMENT_STATUSES.includes(status)) {
            throw new AppError(
                `Statut invalide. Valeurs autorisées : ${ALLOWED_SHIPMENT_STATUSES.join(', ')}`,
                HTTP_STATUS.BAD_REQUEST
            );
        }

        const shipment = await shippingService.updateTracking(shipmentId, status, currentLocation);

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            message: 'Informations de suivi mises à jour',
            data: { shipment },
        });
    });
}

export const shippingController = new ShippingController();
