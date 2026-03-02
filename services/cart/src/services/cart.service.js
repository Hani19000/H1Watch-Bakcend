/**
 * @module Service/Cart
 *
 * Orchestre les opérations du panier : lecture, mutations, fusion guest→user.
 *
 * Pattern : SQL (cart schema) pour la source de vérité + Redis pour la lecture rapide
 * + HTTP vers le product-service pour la validation du stock et l'enrichissement.
 *
 * Responsabilités :
 * - Gérer le cycle de vie du panier (création, mutations, vidage)
 * - Valider le stock via le product-client avant chaque ajout/mise à jour
 * - Enrichir les items avec les données produit pour la réponse API
 * - Invalider le cache à chaque mutation
 *
 * Hors-scope :
 * - Réservation de stock (c'est le rôle de l'order-service au checkout)
 * - Données produit en direct (déléguées au product-client)
 */
import { cartsRepo } from '../repositories/index.js';
import { productClient } from '../clients/product.client.js';
import { cacheService } from './cache.service.js';
import { AppError, ValidationError } from '../utils/appError.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { ERRORS } from '../constants/errors.js';
import { ENV } from '../config/environment.js';

class CartService {
    constructor() {
        if (CartService.instance) return CartService.instance;
        CartService.instance = this;
        Object.freeze(this);
    }

    // ─────────────────────────────────────────────────────────────────────
    // UTILITAIRES CACHE
    // ─────────────────────────────────────────────────────────────────────

    #getCacheKey(cartId) {
        return `cart:${cartId}`;
    }

    async #invalidateCartCache(cartId) {
        await cacheService.delete(this.#getCacheKey(cartId));
    }

    // ─────────────────────────────────────────────────────────────────────
    // LECTURE
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Récupère le panier enrichi avec les données produit et les totaux.
     * Tente le cache en premier — si absent, construit le panier depuis DB + product-service.
     * TTL long (24h) car le cache est systématiquement invalidé à chaque mutation.
     */
    async getFullCart(cartId) {
        const cacheKey = this.#getCacheKey(cartId);

        const cached = await cacheService.get(cacheKey);
        if (cached) return cached;

        const rawItems = await cartsRepo.listRawItems(cartId);
        const items = await productClient.enrichCartItems(rawItems);

        const subTotal = items.reduce((sum, item) => {
            // Les articles indisponibles (produit supprimé) ne contribuent pas au total
            if (item.isUnavailable || item.price === null) return sum;
            return sum + item.price * item.quantity;
        }, 0);

        const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

        const result = {
            id: cartId,
            items,
            summary: {
                subTotal: parseFloat(subTotal.toFixed(2)),
                itemCount,
                currency: 'EUR',
            },
        };

        await cacheService.set(cacheKey, result, ENV.cache.cartTtl);

        return result;
    }

    /**
     * Retourne le panier complet d'un utilisateur (crée le panier s'il n'existe pas).
     */
    async getCartByUserId(userId) {
        const cart = await cartsRepo.getOrCreate(userId);
        return this.getFullCart(cart.id);
    }

    // ─────────────────────────────────────────────────────────────────────
    // MUTATIONS
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Ajoute un article au panier après validation du stock.
     * Vérifie via le product-service que la variante existe ET que le stock est suffisant.
     * Ne réserve pas le stock — la réservation est réalisée par l'order-service au checkout.
     */
    async addToCart(userId, variantId, quantity) {
        const cart = await cartsRepo.getOrCreate(userId);

        const { variant, inventory } = await productClient.getVariantWithInventory(variantId);

        if (!variant) {
            throw new AppError(ERRORS.CART.VARIANT_NOT_FOUND, HTTP_STATUS.NOT_FOUND);
        }

        const available = inventory?.availableStock ?? 0;
        if (available < quantity) {
            throw new ValidationError(
                `${ERRORS.CART.INSUFFICIENT_STOCK}. Disponible : ${available}`
            );
        }

        const result = await cartsRepo.addItem({ cartId: cart.id, variantId, quantity });
        await this.#invalidateCartCache(cart.id);

        return result;
    }

    /**
     * Met à jour la quantité d'un article identifié par son id dans le panier.
     * Vérifie que l'article appartient bien au panier de l'utilisateur (ownership).
     */
    async updateItemQuantity(userId, itemId, newQuantity) {
        const cart = await cartsRepo.getOrCreate(userId);
        const rawItems = await cartsRepo.listRawItems(cart.id);

        const item = rawItems.find((i) => String(i.id) === String(itemId));
        if (!item) {
            throw new AppError(ERRORS.CART.ITEM_NOT_FOUND, HTTP_STATUS.NOT_FOUND);
        }

        const inventory = await productClient.getInventory(item.variantId);
        const available = inventory?.availableStock ?? 0;

        if (available < newQuantity) {
            throw new ValidationError(
                `${ERRORS.CART.INSUFFICIENT_STOCK} : seulement ${available} disponibles.`
            );
        }

        const result = await cartsRepo.updateItemQuantityById(itemId, newQuantity);
        await this.#invalidateCartCache(cart.id);

        return result;
    }

    /**
     * Supprime un article du panier.
     * Vérifie l'appartenance au panier avant la suppression.
     */
    async removeItemFromCart(userId, itemId) {
        const cart = await cartsRepo.getOrCreate(userId);
        const rawItems = await cartsRepo.listRawItems(cart.id);

        const itemExists = rawItems.some((i) => String(i.id) === String(itemId));
        if (!itemExists) {
            throw new AppError(ERRORS.CART.ITEM_NOT_FOUND, HTTP_STATUS.NOT_FOUND);
        }

        await cartsRepo.removeItem(itemId);
        await this.#invalidateCartCache(cart.id);

        return true;
    }

    /**
     * Vide le panier de l'utilisateur sans le supprimer.
     * Appelé après checkout réussi ou par action utilisateur.
     */
    async clearCartByUserId(userId) {
        const cart = await cartsRepo.getOrCreate(userId);
        await cartsRepo.clearItems(cart.id);
        await this.#invalidateCartCache(cart.id);
        return true;
    }

    /**
     * Fusionne un panier guest (session) dans le panier d'un utilisateur connecté.
     * Appelé après connexion pour ne pas perdre les articles ajoutés avant login.
     *
     * Chaque article guest est ajouté au panier utilisateur avec validation du stock.
     * Le panier guest est supprimé après la fusion.
     *
     * @param {string} guestCartId - UUID du panier guest à fusionner
     * @param {string} userId      - UUID de l'utilisateur connecté
     */
    async mergeCarts(guestCartId, userId) {
        const guestItems = await cartsRepo.listRawItems(guestCartId);

        // addToCart gère le stock et l'invalidation de cache à chaque itération
        for (const item of guestItems) {
            try {
                await this.addToCart(userId, item.variantId, item.quantity);
            } catch {
                // Stock insuffisant ou produit supprimé — on ignore et on continue la fusion
                // pour ne pas bloquer l'ensemble de la fusion sur un seul article problématique
            }
        }

        // Suppression du panier guest après fusion réussie
        await cartsRepo.delete(guestCartId).catch(() => {
            // Le panier guest peut avoir déjà été supprimé — on ignore l'erreur
        });

        const userCart = await cartsRepo.getOrCreate(userId);
        return this.getFullCart(userCart.id);
    }
}

export const cartService = new CartService();
