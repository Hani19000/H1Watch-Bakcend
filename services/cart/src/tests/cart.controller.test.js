/**
 * @module Tests/CartController
 *
 * Tests unitaires du cart.controller.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/cart.service.js', () => ({
    cartService: {
        getCartByUserId: vi.fn(),
        addToCart: vi.fn(),
        updateItemQuantity: vi.fn(),
        removeItemFromCart: vi.fn(),
        clearCartByUserId: vi.fn(),
    },
}));

import { cartController } from '../controllers/cart.controller.js';
import { cartService } from '../services/cart.service.js';

const mockUser = { id: 'user-123', email: 'test@test.com', roles: ['USER'] };

const createMockRes = () => ({
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
});

beforeEach(() => vi.clearAllMocks());

describe('CartController', () => {
    it('getCart - devrait retourner le panier avec statut 200', async () => {
        const mockCart = { id: 'cart-1', items: [], summary: { subTotal: 0, itemCount: 0 } };
        cartService.getCartByUserId.mockResolvedValue(mockCart);

        const req = { user: mockUser };
        const res = createMockRes();

        await cartController.getCart(req, res, vi.fn());

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ status: 'success', data: { cart: mockCart } });
    });

    it('clear - devrait appeler clearCartByUserId avec l\'userId', async () => {
        cartService.clearCartByUserId.mockResolvedValue(true);

        const req = { user: mockUser };
        const res = createMockRes();

        await cartController.clear(req, res, vi.fn());

        expect(cartService.clearCartByUserId).toHaveBeenCalledWith(mockUser.id);
        expect(res.status).toHaveBeenCalledWith(200);
    });
});
