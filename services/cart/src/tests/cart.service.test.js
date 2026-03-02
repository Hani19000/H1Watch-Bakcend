/**
 * @module Tests/CartService
 *
 * Tests unitaires du cart.service avec mocks complets des dépendances.
 * Vérifie la logique métier sans appels réels à la DB ou au product-service.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks déclarés avant les imports pour que Vitest les hoiste correctement
vi.mock('../repositories/carts.repo.js', () => ({
    cartsRepo: {
        getOrCreate: vi.fn(),
        listRawItems: vi.fn(),
        addItem: vi.fn(),
        updateItemQuantityById: vi.fn(),
        removeItem: vi.fn(),
        clearItems: vi.fn(),
        delete: vi.fn(),
    },
}));

vi.mock('../clients/product.client.js', () => ({
    productClient: {
        getVariantWithInventory: vi.fn(),
        getInventory: vi.fn(),
        enrichCartItems: vi.fn(),
    },
}));

vi.mock('../services/cache.service.js', () => ({
    cacheService: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
    },
}));

import { cartService } from '../services/cart.service.js';
import { cartsRepo } from '../repositories/carts.repo.js';
import { productClient } from '../clients/product.client.js';

const MOCK_USER_ID = '11111111-1111-4111-8111-111111111111';
const MOCK_CART_ID = '22222222-2222-4222-8222-222222222222';
const MOCK_VARIANT_ID = '33333333-3333-4333-8333-333333333333';
const MOCK_ITEM_ID = 1;

beforeEach(() => {
    vi.clearAllMocks();
});

describe('CartService', () => {
    describe('addToCart', () => {
        it('devrait ajouter un article quand le stock est suffisant', async () => {
            cartsRepo.getOrCreate.mockResolvedValue({ id: MOCK_CART_ID });
            productClient.getVariantWithInventory.mockResolvedValue({
                variant: { id: MOCK_VARIANT_ID, price: 99.99, sku: 'TEST-001' },
                inventory: { availableStock: 10 },
            });
            cartsRepo.addItem.mockResolvedValue({ id: MOCK_ITEM_ID, variantId: MOCK_VARIANT_ID, quantity: 2 });

            const result = await cartService.addToCart(MOCK_USER_ID, MOCK_VARIANT_ID, 2);

            expect(cartsRepo.addItem).toHaveBeenCalledWith({
                cartId: MOCK_CART_ID,
                variantId: MOCK_VARIANT_ID,
                quantity: 2,
            });
            expect(result).toBeDefined();
        });

        it('devrait lancer une erreur si le stock est insuffisant', async () => {
            cartsRepo.getOrCreate.mockResolvedValue({ id: MOCK_CART_ID });
            productClient.getVariantWithInventory.mockResolvedValue({
                variant: { id: MOCK_VARIANT_ID, price: 99.99 },
                inventory: { availableStock: 1 },
            });

            await expect(
                cartService.addToCart(MOCK_USER_ID, MOCK_VARIANT_ID, 5)
            ).rejects.toThrow('Stock insuffisant');
        });

        it('devrait lancer une erreur si la variante n\'existe pas', async () => {
            cartsRepo.getOrCreate.mockResolvedValue({ id: MOCK_CART_ID });
            productClient.getVariantWithInventory.mockResolvedValue({
                variant: null,
                inventory: null,
            });

            await expect(
                cartService.addToCart(MOCK_USER_ID, MOCK_VARIANT_ID, 1)
            ).rejects.toThrow('Produit introuvable');
        });
    });

    describe('removeItemFromCart', () => {
        it('devrait supprimer un article appartenant au panier', async () => {
            cartsRepo.getOrCreate.mockResolvedValue({ id: MOCK_CART_ID });
            cartsRepo.listRawItems.mockResolvedValue([
                { id: MOCK_ITEM_ID, variantId: MOCK_VARIANT_ID, quantity: 2 },
            ]);
            cartsRepo.removeItem.mockResolvedValue(true);

            const result = await cartService.removeItemFromCart(MOCK_USER_ID, MOCK_ITEM_ID);

            expect(cartsRepo.removeItem).toHaveBeenCalledWith(MOCK_ITEM_ID);
            expect(result).toBe(true);
        });

        it('devrait lancer une erreur si l\'article n\'appartient pas au panier', async () => {
            cartsRepo.getOrCreate.mockResolvedValue({ id: MOCK_CART_ID });
            cartsRepo.listRawItems.mockResolvedValue([]);

            await expect(
                cartService.removeItemFromCart(MOCK_USER_ID, 'item-inexistant')
            ).rejects.toThrow("Cet article n'existe pas dans votre panier");
        });
    });

    describe('clearCartByUserId', () => {
        it('devrait vider le panier de l\'utilisateur', async () => {
            cartsRepo.getOrCreate.mockResolvedValue({ id: MOCK_CART_ID });
            cartsRepo.clearItems.mockResolvedValue(true);

            const result = await cartService.clearCartByUserId(MOCK_USER_ID);

            expect(cartsRepo.clearItems).toHaveBeenCalledWith(MOCK_CART_ID);
            expect(result).toBe(true);
        });
    });

    describe('getCartByUserId', () => {
        it('devrait retourner le panier enrichi avec les totaux', async () => {
            cartsRepo.getOrCreate.mockResolvedValue({ id: MOCK_CART_ID });
            cartsRepo.listRawItems.mockResolvedValue([
                { id: 1, cartId: MOCK_CART_ID, variantId: MOCK_VARIANT_ID, quantity: 2 },
            ]);
            productClient.enrichCartItems.mockResolvedValue([
                { id: 1, variantId: MOCK_VARIANT_ID, quantity: 2, price: 50.00, isUnavailable: false },
            ]);

            const cart = await cartService.getCartByUserId(MOCK_USER_ID);

            expect(cart.id).toBe(MOCK_CART_ID);
            expect(cart.summary.subTotal).toBe(100.00);
            expect(cart.summary.itemCount).toBe(2);
        });
    });
});
