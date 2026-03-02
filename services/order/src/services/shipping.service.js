/**
 * @module Service/Shipping
 *
 * Gère les frais de port avec calcul basé sur le poids, la zone et le type de service.
 * Intègre les adresses de livraison et le suivi des expéditions.
 */
import { shipmentsRepo, ordersRepo } from '../repositories/index.js';
import { cacheService } from './cache.service.js';
import { AppError, ValidationError, BusinessError } from '../utils/appError.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { ORDER_STATUS } from '../constants/enums.js';

class ShippingService {
    // Grille tarifaire centralisée par zone géographique.
    // Permet d'ajuster les tarifs sans modifier la logique de calcul.
    #shippingRates = {
        FRANCE: {
            STANDARD: { base: 5.90, perKg: 0.50, freeAbove: 50 },
            EXPRESS: { base: 9.90, perKg: 1.00, freeAbove: 100 },
            RELAY: { base: 3.90, perKg: 0.30, freeAbove: 40 },
        },
        EUROPE: {
            STANDARD: { base: 12.50, perKg: 1.50, freeAbove: 80 },
            EXPRESS: { base: 24.90, perKg: 3.00, freeAbove: 150 },
        },
        INTERNATIONAL: {
            STANDARD: { base: 25.00, perKg: 5.00, freeAbove: 200 },
            EXPRESS: { base: 45.00, perKg: 8.00, freeAbove: null },
        },
    };

    // Mapping pays → zone pour simplifier les lookups.
    #countryZones = {
        France: 'FRANCE',
        Belgium: 'EUROPE',
        Germany: 'EUROPE',
        Spain: 'EUROPE',
        Italy: 'EUROPE',
        Netherlands: 'EUROPE',
        Portugal: 'EUROPE',
        Switzerland: 'EUROPE',
        DEFAULT: 'INTERNATIONAL',
    };

    constructor() {
        if (ShippingService.instance) return ShippingService.instance;
        ShippingService.instance = this;
        Object.freeze(this);
    }

    #getZone(country) {
        return this.#countryZones[country] || this.#countryZones.DEFAULT;
    }

    /**
     * Calcule les frais de port selon le poids total, la zone et le mode de livraison.
     * Applique automatiquement le franco si le seuil de commande est atteint.
     */
    calculateShippingCost(country, totalWeight, shippingMethod = 'STANDARD', cartSubtotal = 0) {
        const zone = this.#getZone(country);
        const rates = this.#shippingRates[zone];

        if (!rates || !rates[shippingMethod]) {
            throw new ValidationError(
                `Méthode de livraison "${shippingMethod}" non disponible pour ${country}`
            );
        }

        const { base, perKg, freeAbove } = rates[shippingMethod];

        if (freeAbove !== null && cartSubtotal >= freeAbove) {
            return {
                cost: 0,
                isFree: true,
                zone,
                method: shippingMethod,
                estimatedDays: this.#getEstimatedDelivery(zone, shippingMethod),
            };
        }

        return {
            cost: Math.round((base + perKg * totalWeight) * 100) / 100,
            isFree: false,
            zone,
            method: shippingMethod,
            estimatedDays: this.#getEstimatedDelivery(zone, shippingMethod),
        };
    }

    #getEstimatedDelivery(zone, method) {
        const estimates = {
            FRANCE: { STANDARD: '2-3', EXPRESS: '24h', RELAY: '3-5' },
            EUROPE: { STANDARD: '5-7', EXPRESS: '2-3' },
            INTERNATIONAL: { STANDARD: '10-15', EXPRESS: '5-7' },
        };
        return estimates[zone]?.[method] || '7-14';
    }

    /**
     * Retourne toutes les options de livraison disponibles pour un pays donné.
     * Mis en cache car les tarifs ne changent pas à chaque requête.
     */
    async getAvailableOptions(country, totalWeight, cartSubtotal = 0) {
        const cacheKey = `shipping:options:${country}:${totalWeight}:${cartSubtotal}`;
        const cached = await cacheService.get(cacheKey);
        if (cached) return cached;

        const zone = this.#getZone(country);
        const methods = Object.keys(this.#shippingRates[zone] || {});

        const options = methods.map((method) => {
            const { cost, isFree, estimatedDays } = this.calculateShippingCost(
                country, totalWeight, method, cartSubtotal
            );
            return { method, cost, isFree, estimatedDays, label: this.#getMethodLabel(method) };
        });

        await cacheService.set(cacheKey, options, 3600);
        return options;
    }

    #getMethodLabel(method) {
        const labels = {
            STANDARD: 'Livraison Standard',
            EXPRESS: 'Livraison Express',
            RELAY: 'Point Relais',
        };
        return labels[method] || method;
    }

    /**
     * @deprecated Utiliser calculateShippingCost à la place.
     * Conservé pour compatibilité avec l'ancien code.
     */
    async calculateRates(cartId, { country }) {
        const zone = this.#getZone(country);
        const rate = this.#shippingRates[zone]?.STANDARD;

        if (!rate) {
            throw new ValidationError('Zone de livraison non supportée');
        }

        return {
            carrier: 'COLISSIMO',
            price: rate.base + rate.perKg,
            estimatedDays: this.#getEstimatedDelivery(zone, 'STANDARD'),
        };
    }

    // === GESTION DES ADRESSES ===

    // async getUserAddresses(userId) {
    //     const cacheKey = `user:${userId}:addresses`;
    //     const cached = await cacheService.get(cacheKey);
    //     if (cached) return cached;

    //     const addresses = await addressesRepo.findByUserId(userId);
    //     await cacheService.set(cacheKey, addresses, 1800);
    //     return addresses;
    // }

    // async createAddress(userId, addressData) {
    //     const address = await addressesRepo.create(userId, addressData);
    //     await cacheService.delete(`user:${userId}:addresses`);
    //     return address;
    // }

    // async deleteAddress(userId, addressId) {
    //     const deleted = await addressesRepo.delete(userId, addressId);
    //     if (!deleted) throw new AppError('Adresse non trouvée', HTTP_STATUS.NOT_FOUND);
    // }

    // === GESTION DES EXPÉDITIONS ===

    /**
     * Crée une expédition avec numéro de suivi.
     * Seules les commandes PAID peuvent être expédiées pour éviter les erreurs logistiques.
     */
    async createShipment(orderId, carrier = 'COLISSIMO') {
        const order = await ordersRepo.findById(orderId);
        if (!order) throw new AppError('Commande introuvable', HTTP_STATUS.NOT_FOUND);

        if (order.status !== ORDER_STATUS.PAID) {
            throw new BusinessError('La commande doit être payée avant expédition');
        }

        const trackingNumber = `${carrier.substring(0, 3)}-${Math.random()
            .toString(36)
            .toUpperCase()
            .substring(2, 10)}`;

        const shipment = await shipmentsRepo.create({
            orderId,
            carrier,
            trackingNumber,
            status: 'PREPARING',
        });

        await ordersRepo.updateStatus(orderId, 'SHIPPING_IN_PROGRESS');
        return shipment;
    }

    /**
     * Met à jour le statut de l'expédition et propage le changement à la commande.
     * La livraison confirmée déclenche automatiquement la clôture de la commande.
     */
    async updateTracking(shipmentId, status, currentLocation = '') {
        const updated = await shipmentsRepo.update(shipmentId, {
            status,
            currentLocation,
            updatedAt: new Date(),
        });

        if (status === 'DELIVERED') {
            const shipment = await shipmentsRepo.findById(shipmentId);
            await ordersRepo.updateStatus(shipment.orderId, 'COMPLETED');
            await cacheService.delete(`order:${shipment.orderId}`);
        }

        return updated;
    }

    async getShipmentByOrder(orderId) {
        return await shipmentsRepo.findByOrderId(orderId);
    }

    async getShipmentForUser(orderId, userId) {
        const order = await ordersRepo.findById(orderId);

        // Vérification de propriété avant exposition des données d'expédition.
        if (!order || order.userId !== userId) {
            throw new AppError('Accès non autorisé à cette expédition', HTTP_STATUS.FORBIDDEN);
        }

        return await shipmentsRepo.findByOrderId(orderId);
    }
}

export const shippingService = new ShippingService();