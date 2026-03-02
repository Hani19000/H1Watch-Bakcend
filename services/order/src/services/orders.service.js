/**
 * @module Service/Order
 *
 * Orchestre la création, l'annulation et le suivi des commandes.
 * Source de vérité pour le cycle de vie d'une commande.
 *
 * ARCHITECTURE INTER-SERVICES :
 * Les opérations de stock (reserve/release) passent par HTTP vers le monolith
 * au lieu d'appels directs en base. En cas d'échec, une saga compensatoire
 * annule les réservations déjà effectuées pour garantir la cohérence.
 *
 * PÉRIMÈTRE DE CE SERVICE :
 * - Tables : orders, order_items, shipments (schéma "order")
 * - Appels HTTP : inventoryClient (stock), productClient (prix, poids), notificationClient (emails)
 * - Calculs purs : shippingService, taxService (aucune DB)
 */
import { ordersRepo, shipmentsRepo } from '../repositories/index.js';
import { usersRepo } from '../repositories/users.repo.js';
import { inventoryClient } from '../clients/inventory.client.js';
import { productClient } from '../clients/product.client.js';
import { notificationClient } from '../clients/notification.client.js';
import { shippingService } from './shipping.service.js';
import { taxService } from './tax.service.js';
import { cacheService } from './cache.service.js';
import { AppError, ValidationError, BusinessError } from '../utils/appError.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { ORDER_STATUS } from '../constants/enums.js';
import { pgPool } from '../config/database.js';
import { logInfo, logError } from '../utils/logger.js';
import crypto from 'crypto';

class OrderService {
    constructor() {
        if (OrderService.instance) return OrderService.instance;
        OrderService.instance = this;
        Object.freeze(this);
    }

    // ─────────────────────────────────────────────────────────────────────
    // HELPERS PRIVÉS
    // ─────────────────────────────────────────────────────────────────────

    #calculateTotals(itemsWithRealPrices, shippingCountry, shippingMethod, taxCategory) {
        const subtotal = itemsWithRealPrices.reduce(
            (sum, item) => sum + Number(item.price) * item.quantity,
            0
        );
        const totalWeight = itemsWithRealPrices.reduce(
            (sum, item) => sum + Number(item.weight || 0.5) * item.quantity,
            0
        );
        const shippingCost = shippingService.calculateShippingCost(
            shippingCountry, totalWeight, shippingMethod, subtotal
        );
        const taxableAmount = subtotal + shippingCost.cost;
        const taxCalculation = taxService.calculateTax(taxableAmount, shippingCountry, taxCategory);

        return {
            subtotal: Math.round(subtotal * 100) / 100,
            shipping: {
                cost: shippingCost.cost,
                method: shippingMethod,
                isFree: shippingCost.isFree,
                estimatedDays: shippingCost.estimatedDays,
            },
            tax: {
                amount: taxCalculation.taxAmount,
                rate: taxCalculation.taxRate,
                category: taxCategory,
            },
            totalAmount: Math.round((taxableAmount + taxCalculation.taxAmount) * 100) / 100,
        };
    }

    async #artificialDelay() {
        const delayMs = 200 + Math.random() * 300;
        return new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    /**
     * Comparaison d'emails résistante aux timing attacks.
     * Évite de révéler l'existence d'un compte via un différentiel de temps de réponse.
     */
    async #timingSafeEmailCompare(storedEmail, providedEmail) {
        try {
            const storedBuffer = Buffer.from(storedEmail, 'utf8');
            const providedBuffer = Buffer.from(providedEmail, 'utf8');
            const maxLength = Math.max(storedBuffer.length, providedBuffer.length);
            const paddedStored = Buffer.alloc(maxLength);
            const paddedProvided = Buffer.alloc(maxLength);
            storedBuffer.copy(paddedStored);
            providedBuffer.copy(paddedProvided);
            return crypto.timingSafeEqual(paddedStored, paddedProvided);
        } catch {
            return false;
        }
    }

    /**
     * Résout le prix effectif en tenant compte des promotions actives.
     * Délègue au monolith via HTTP — retourne le prix de base en cas d'erreur
     * pour ne pas bloquer la création de commande.
     */
    async #resolveEffectivePrice(variantId, basePrice) {
        try {
            const promotionData = await productClient.getPromotionPrice(variantId);

            if (!promotionData?.hasPromotion) {
                return basePrice;
            }

            return promotionData.effectivePrice;
        } catch (error) {
            // En cas d'indisponibilité du service produit, on utilise le prix de base
            // pour ne pas bloquer le checkout. L'erreur est loggée pour monitoring.
            logError(error, { context: 'OrderService.resolveEffectivePrice', variantId });
            return basePrice;
        }
    }

    /**
     * Invalide les entrées Redis liées à une variante produit.
     * Fire-and-forget : ne bloque jamais le flux principal.
     */
    async #invalidateVariantCache(variantId) {
        try {
            await cacheService.delete(`stock:variant:${variantId}`);
        } catch (error) {
            logError(error, { context: 'OrderService.invalidateVariantCache', variantId });
        }
    }

    /**
     * Saga compensatoire : libère le stock réservé pour chaque article d'une liste.
     * Appelée lors d'un rollback pour annuler les réservations partielles.
     * Chaque libération est best-effort : une erreur sur un article ne bloque pas les autres.
     *
     * @param {Array<{ variantId: string, quantity: number }>} reservedItems
     */
    async #compensateReservations(reservedItems) {
        for (const item of reservedItems) {
            try {
                await inventoryClient.release(item.variantId, item.quantity);
            } catch (error) {
                // On log et on continue — une libération manquée sera rattrapée par le cron.
                logError(error, {
                    context: 'OrderService.compensateReservations',
                    variantId: item.variantId,
                    quantity: item.quantity,
                });
            }
        }
    }

    /**
     * Résout l'email du destinataire pour les notifications.
     * Priorité à l'adresse de livraison (valable Guest et User),
     * fallback sur le compte utilisateur si disponible.
     *
     * @private
     * @param {string|null} userId    - ID de l'utilisateur connecté (null si guest)
     * @param {object}      orderData - Données de la commande
     * @returns {Promise<string|null>}
     */
    async #resolveCustomerEmail(userId, orderData) {
        if (orderData?.shippingAddress?.email) {
            return orderData.shippingAddress.email;
        }

        if (userId) {
            try {
                const user = await usersRepo.findById(userId);
                if (user?.email) return user.email;
            } catch (error) {
                logError(error, { context: 'OrderService.resolveCustomerEmail', userId });
            }
        }

        return null;
    }

    // ─────────────────────────────────────────────────────────────────────
    // ANNULATION & LIBÉRATION DE STOCK
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Annule une commande et libère le stock réservé via saga compensatoire.
     *
     * Source de vérité pour toute annulation, qu'elle soit déclenchée par :
     * - L'utilisateur (clic "Annuler" depuis le frontend)
     * - Le webhook Stripe (checkout.session.expired)
     * - Le cron de nettoyage (commandes PENDING expirées)
     *
     * Le statut CANCELLED est mis à jour en base dans une transaction atomique.
     * Les libérations de stock (HTTP) sont best-effort : une erreur est loggée
     * sans faire échouer l'annulation en base.
     *
     * @param {string} orderId  - UUID de la commande à annuler
     * @param {string} reason   - Motif pour les logs (traçabilité)
     */
    async cancelOrderAndReleaseStock(orderId, reason = 'manual_cancel') {
        const client = await pgPool.connect();

        try {
            await client.query('BEGIN');

            const items = await ordersRepo.listItems(orderId, client);

            // On marque d'abord CANCELLED en base pour garantir l'idempotence.
            // Les libérations HTTP qui échouent seront rattrapées par le cron.
            await client.query(
                `UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2`,
                [ORDER_STATUS.CANCELLED, orderId]
            );

            await client.query('COMMIT');

            logInfo(`[Stock] Commande annulée — orderId: ${orderId}, reason: ${reason}`);

            // Libérations HTTP hors transaction — best-effort.
            for (const item of items) {
                inventoryClient
                    .release(item.variantId, item.quantity)
                    .catch((err) =>
                        logError(err, { context: 'cancelOrderAndReleaseStock.release', orderId, variantId: item.variantId })
                    );

                this.#invalidateVariantCache(item.variantId).catch(() => { });
            }

        } catch (error) {
            await client.query('ROLLBACK');
            logError(error, { context: 'OrderService.cancelOrderAndReleaseStock', orderId, reason });
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Annule une commande PENDING à la demande d'un utilisateur ou d'un guest.
     *
     * Sécurité :
     * - Mode authentifié : vérifie que la commande appartient bien à l'utilisateur
     * - Mode guest : vérifie l'email de la commande comme second facteur
     * - Seules les commandes PENDING peuvent être annulées ici (PAID est protégé)
     * - Idempotence : retourne sans erreur si la commande est déjà CANCELLED
     *
     * @param {string} orderId      - UUID de la commande
     * @param {Object|null} user    - Utilisateur connecté (null si guest)
     * @param {string|null} email   - Email de vérification (requis si guest)
     */
    async cancelPendingOrder(orderId, user = null, email = null) {
        const order = await ordersRepo.findById(orderId);

        if (!order) {
            throw new AppError('Commande introuvable', HTTP_STATUS.NOT_FOUND);
        }

        if (order.status === ORDER_STATUS.PAID) {
            throw new BusinessError("Impossible d'annuler une commande déjà payée");
        }

        if (order.status === ORDER_STATUS.CANCELLED) {
            return { message: 'Commande déjà annulée' };
        }

        await this._assertOrderAccess(order, user, email);

        await this.cancelOrderAndReleaseStock(orderId, 'user_cancel');

        return { message: 'Commande annulée avec succès' };
    }

    /**
     * Vérifie que l'appelant est autorisé à accéder à la commande.
     * Centralise la logique d'autorisation guest/authentifié.
     *
     * @param {Object} order        - Commande récupérée en base
     * @param {Object|null} user    - Utilisateur connecté
     * @param {string|null} email   - Email fourni par un guest
     * @throws {AppError}           - 403 si l'accès est non autorisé
     */
    async _assertOrderAccess(order, user, email) {
        if (user) {
            if (order.userId && order.userId !== user.id) {
                throw new AppError('Cette commande ne vous appartient pas', HTTP_STATUS.FORBIDDEN);
            }
            return;
        }

        const orderEmail = order.shippingAddress?.email?.trim().toLowerCase();
        const providedEmail = email?.trim().toLowerCase();

        if (!providedEmail || !orderEmail || providedEmail !== orderEmail) {
            throw new AppError(
                'Email requis ou incorrect pour accéder à cette commande',
                HTTP_STATUS.FORBIDDEN
            );
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // CRÉATION & PRÉVISUALISATION
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Crée une commande à partir des articles du panier.
     *
     * SAGA COMPENSATOIRE :
     * Les réservations de stock sont effectuées via HTTP avant la transaction DB.
     * Si une réservation échoue (stock insuffisant ou monolith inaccessible),
     * les réservations déjà effectuées sont libérées avant de propager l'erreur.
     *
     * Si la transaction DB échoue après toutes les réservations,
     * la saga compensatoire libère également tout le stock.
     */
    async createOrderFromCart(userId = null, checkoutData) {
        const {
            items,
            shippingAddress,
            shippingMethod = 'STANDARD',
            shippingCountry = 'France',
            taxCategory = 'standard',
        } = checkoutData;

        if (!items || !Array.isArray(items) || items.length === 0) {
            throw new ValidationError('Le panier est vide');
        }

        // Réservations de stock — hors transaction DB (HTTP inter-service)
        const reservedItems = [];
        const itemsWithRealPrices = [];

        try {
            for (const item of items) {
                // reserve() retourne { price, weight } depuis le monolith
                const inventoryData = await inventoryClient.reserve(item.variantId, item.quantity);
                reservedItems.push({ variantId: item.variantId, quantity: item.quantity });

                const effectivePrice = await this.#resolveEffectivePrice(
                    item.variantId,
                    inventoryData.price
                );

                itemsWithRealPrices.push({
                    ...item,
                    price: effectivePrice,
                    basePrice: inventoryData.price,
                    weight: inventoryData.weight || 0.5,
                });
            }
        } catch (error) {
            // Saga compensatoire : libère le stock déjà réservé avant de propager l'erreur.
            await this.#compensateReservations(reservedItems);
            throw error;
        }

        // Transaction DB — persistance de la commande
        const client = await pgPool.connect();
        try {
            await client.query('BEGIN');

            const totals = this.#calculateTotals(
                itemsWithRealPrices, shippingCountry, shippingMethod, taxCategory
            );

            const order = await ordersRepo.createOrder(client, {
                userId: userId || null,
                subtotalAmount: totals.subtotal,
                shippingCost: totals.shipping.cost,
                shippingMethod: totals.shipping.method,
                taxAmount: totals.tax.amount,
                taxRate: totals.tax.rate,
                totalAmount: totals.totalAmount,
                shippingAddress,
                status: ORDER_STATUS.PENDING,
            });

            for (const item of itemsWithRealPrices) {
                await ordersRepo.addItem(client, {
                    orderId: order.id,
                    variantId: item.variantId,
                    productName: item.productName,
                    variantAttributes: item.variantAttributes,
                    unitPrice: item.price,
                    quantity: item.quantity,
                });
            }

            await client.query('COMMIT');

            for (const item of itemsWithRealPrices) {
                this.#invalidateVariantCache(item.variantId).catch(() => { });
            }

            return { ...order, pricing: totals };

        } catch (error) {
            await client.query('ROLLBACK');
            // La DB a échoué après les réservations HTTP : on libère tout le stock.
            await this.#compensateReservations(reservedItems);
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Prévisualise le total d'une commande sans réserver de stock.
     * Les items doivent être passés explicitement (le panier appartient au monolith).
     */
    async previewOrderTotal(userId = null, checkoutData) {
        const {
            items,
            shippingMethod = 'STANDARD',
            shippingCountry = 'France',
            taxCategory = 'standard',
        } = checkoutData;

        if (!items || items.length === 0) {
            throw new ValidationError('Le panier est vide');
        }

        const itemsWithRealPrices = await Promise.all(
            items.map(async (item) => {
                // getVariant() retourne { price, weight } sans toucher au stock
                const variant = await productClient.getVariant(item.variantId);
                if (!variant) throw new AppError('Produit introuvable', HTTP_STATUS.NOT_FOUND);

                const effectivePrice = await this.#resolveEffectivePrice(
                    item.variantId,
                    variant.price
                );

                return { ...item, price: effectivePrice, weight: variant.weight || 0.5 };
            })
        );

        return {
            ...this.#calculateTotals(itemsWithRealPrices, shippingCountry, shippingMethod, taxCategory),
            currency: 'EUR',
        };
    }

    // ─────────────────────────────────────────────────────────────────────
    // LECTURE — MODE AUTHENTIFIÉ
    // ─────────────────────────────────────────────────────────────────────

    async getUserOrders(userId) {
        const orders = await ordersRepo.listByUserId(userId);
        return await Promise.all(
            orders.map(async (order) => ({
                ...order,
                items: await ordersRepo.listItems(order.id),
            }))
        );
    }

    async getOrderDetails(orderId, user) {
        const order = await ordersRepo.findById(orderId);
        if (!order) throw new AppError('Commande introuvable', HTTP_STATUS.NOT_FOUND);

        const isAdmin = user.roles?.some((r) => r.toUpperCase() === 'ADMIN');
        if (order.userId !== user.id && !isAdmin) {
            throw new AppError('Accès non autorisé', HTTP_STATUS.FORBIDDEN);
        }

        const items = await ordersRepo.listItems(orderId);
        return { ...order, items };
    }

    async getOrderHistory(userId, options = {}) {
        // La pagination et le filtrage sont désormais faits en SQL dans ordersRepo.listByUserId
        // pour éviter de charger toutes les commandes en mémoire (N+1 et DeprecationWarning pg).
        return await ordersRepo.listByUserId(userId, options);
    }

    // ─────────────────────────────────────────────────────────────────────
    // LECTURE — MODE GUEST (suivi public)
    // ─────────────────────────────────────────────────────────────────────

    async getOrderDetailsGuest(orderId, email) {
        if (!email || typeof email !== 'string' || email.trim() === '') {
            throw new ValidationError('Email requis pour accéder aux détails de la commande');
        }

        const order = await ordersRepo.findGuestOnlyById(orderId);
        if (!order) {
            await this.#artificialDelay();
            throw new AppError('Commande introuvable', HTTP_STATUS.NOT_FOUND);
        }

        const storedEmail = order.shippingAddress?.email?.trim().toLowerCase();
        const isEmailMatch = await this.#timingSafeEmailCompare(
            storedEmail,
            email.trim().toLowerCase()
        );

        if (!isEmailMatch) {
            await this.#artificialDelay();
            throw new AppError('Commande introuvable', HTTP_STATUS.NOT_FOUND);
        }

        return order;
    }

    async trackOrderGuest(orderNumber, email) {
        const order = await ordersRepo.findByOrderNumberAndEmail(
            orderNumber.trim().toUpperCase(),
            email.trim().toLowerCase()
        );
        if (!order) {
            await this.#artificialDelay();
            throw new AppError('Commande introuvable', HTTP_STATUS.NOT_FOUND);
        }
        return order;
    }

    // ─────────────────────────────────────────────────────────────────────
    // CLAIM & ADMIN
    // ─────────────────────────────────────────────────────────────────────

    async claimGuestOrder(orderId, newUserId, verificationEmail) {
        try {
            return await ordersRepo.transferOwnership(orderId, newUserId, verificationEmail);
        } catch {
            throw new AppError('Impossible de rattacher cette commande', HTTP_STATUS.BAD_REQUEST);
        }
    }

    async autoClaimGuestOrders(newUserId, email) {
        try {
            const guestOrders = await ordersRepo.findGuestOrdersByEmail(email);
            if (!guestOrders || guestOrders.length === 0) {
                return { claimed: 0, orders: [], claimedOrderNumbers: [] };
            }

            const claimedOrders = [];
            const claimedOrderNumbers = [];

            for (const order of guestOrders) {
                try {
                    const claimed = await ordersRepo.transferOwnership(order.id, newUserId, email);
                    claimedOrders.push(claimed);
                    claimedOrderNumbers.push(order.orderNumber || order.order_number);
                } catch (error) {
                    logError(error, { context: 'OrderService.autoClaimGuestOrders', orderId: order.id });
                }
            }

            return {
                claimed: claimedOrders.length,
                orders: claimedOrders,
                claimedOrderNumbers,
            };
        } catch (error) {
            return { claimed: 0, error: error.message };
        }
    }

    async updateOrderStatus(orderId, newStatus) {
        const order = await ordersRepo.findById(orderId);
        if (!order) throw new AppError('Commande introuvable', HTTP_STATUS.NOT_FOUND);

        const previousStatus = order.status;

        if (order.status === ORDER_STATUS.SHIPPED && newStatus === ORDER_STATUS.CANCELLED) {
            throw new BusinessError("Impossible d'annuler une commande déjà expédiée");
        }

        const updatedOrder = await ordersRepo.updateStatus(orderId, newStatus);
        let shipmentData = null;

        if (newStatus === ORDER_STATUS.SHIPPED) {
            const shipment = await shipmentsRepo.create({ orderId });
            shipmentData = shipment;
        }

        if (newStatus === ORDER_STATUS.CANCELLED) {
            const items = await ordersRepo.listItems(orderId);
            for (const item of items) {
                // Release best-effort : une erreur ne bloque pas le changement de statut
                inventoryClient
                    .release(item.variantId, item.quantity)
                    .catch((err) =>
                        logError(err, { context: 'updateOrderStatus.release', orderId, variantId: item.variantId })
                    );
                this.#invalidateVariantCache(item.variantId).catch(() => { });
            }
        }

        // Fire-and-forget — ne bloque pas la réponse HTTP
        this.#sendOrderStatusNotification(
            previousStatus, newStatus, updatedOrder.userId, updatedOrder, { shipment: shipmentData }
        );

        return updatedOrder;
    }

    async listAllOrders(params) {
        return await ordersRepo.findAll(params);
    }

    // ─────────────────────────────────────────────────────────────────────
    // NOTIFICATION — Délégation vers le notification-service
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Déclenche la notification appropriée selon le nouveau statut de commande.
     * Fire-and-forget : ne propage jamais d'erreur pour ne pas bloquer le flux métier.
     *
     * Aucune notification si :
     *   - Le statut n'a pas changé (idempotence)
     *   - Le statut est PAID (géré par le payment-service après confirmation Stripe)
     *   - L'email du destinataire est introuvable
     *
     * @param {string} previousStatus - Statut avant la mise à jour
     * @param {string} newStatus      - Nouveau statut
     * @param {string|null} userId    - ID de l'utilisateur (null si guest)
     * @param {object} order          - Données de la commande mise à jour
     * @param {object} metadata       - Données supplémentaires (shipment, cancellationReason)
     */
    #sendOrderStatusNotification(previousStatus, newStatus, userId, order, metadata = {}) {
        // Pas de notification si le statut est inchangé
        if (previousStatus === newStatus) return;

        // La confirmation de paiement est envoyée par le payment-service
        // via notificationClient.notifyOrderConfirmation — on ne la duplique pas ici.
        if (newStatus === ORDER_STATUS.PAID) return;

        // Résolution de l'email et dispatch de manière totalement asynchrone.
        // L'absence d'await est intentionnelle : cette opération est fire-and-forget.
        this.#resolveCustomerEmail(userId, order)
            .then((email) => {
                if (!email) {
                    logError(
                        new Error('Email introuvable pour la notification de commande'),
                        { context: 'OrderService.sendOrderStatusNotification', orderId: order.id, newStatus }
                    );
                    return;
                }

                switch (newStatus) {
                    case ORDER_STATUS.SHIPPED:
                        notificationClient.notifyOrderShipped(email, order, metadata.shipment ?? {});
                        break;
                    case ORDER_STATUS.DELIVERED:
                        notificationClient.notifyOrderDelivered(email, order);
                        break;
                    case ORDER_STATUS.CANCELLED:
                        notificationClient.notifyOrderCancelled(email, order, metadata.cancellationReason ?? null);
                        break;
                    default:
                        // Les statuts non gérés (ex: PROCESSING) ne déclenchent pas de notification.
                        logInfo(`[Notification] Statut "${newStatus}" non notifié — orderId: ${order.id}`);
                }
            })
            .catch((error) =>
                logError(error, { context: 'OrderService.sendOrderStatusNotification', orderId: order.id })
            );
    }
}

export const orderService = new OrderService();
