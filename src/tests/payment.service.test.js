import { describe, it, expect, vi, beforeEach } from 'vitest';

// -----------------------------------------------------------------------------
// Mock Stripe
// -----------------------------------------------------------------------------
vi.mock('stripe', () => {
    const mockSessionCreate = vi.fn();
    const mockConstructEvent = vi.fn();

    const StripeMock = vi.fn().mockImplementation(function () {
        return {
            checkout: { sessions: { create: mockSessionCreate } },
            webhooks: { constructEvent: mockConstructEvent }
        };
    });

    StripeMock.instanceMocks = { mockSessionCreate, mockConstructEvent };

    return { default: StripeMock };
});

// -----------------------------------------------------------------------------
// Mock environment
//
// payment.service.js lit ENV.stripe.secretKey au chargement du module.
// Sans ce mock, le service ne s'initialise pas en environnement de test.
// -----------------------------------------------------------------------------
vi.mock('../config/environment.js', () => ({
    ENV: {
        server: { nodeEnv: 'test' },
        database: {
            postgres: { url: 'postgres://test:test@localhost:5432/test' },
            redis: { host: 'localhost', port: 6379, password: '' }
        },
        stripe: { secretKey: 'sk_test', webhookSecret: 'wh_test' },
        PORT: 3000,
        JWT_ACCESS_SECRET: 'test',
        JWT_REFRESH_SECRET: 'test',
        SENTRY_DSN: 'http://test'
    }
}));

// -----------------------------------------------------------------------------
// Mock database
// -----------------------------------------------------------------------------
vi.mock('../config/database.js', () => ({
    pgPool: {
        connect: vi.fn().mockResolvedValue({
            query: vi.fn().mockResolvedValue({ rows: [] }),
            release: vi.fn()
        })
    }
}));

// -----------------------------------------------------------------------------
// Mock repositories
// -----------------------------------------------------------------------------
vi.mock('../repositories/index.js', () => ({
    usersRepo: {
        findById: vi.fn().mockResolvedValue({ id: 'user_abc', email: 'user@test.com' })
    },
    paymentsRepo: {
        create: vi.fn().mockResolvedValue({ id: 'pay_1' }),
        updateByIntentId: vi.fn().mockResolvedValue({ id: 'pay_1', status: 'SUCCESS' })
    },
}));

// -----------------------------------------------------------------------------
// Mock orderClient
//
// payment.service.js délègue toutes les lectures/écritures de commandes
// à l'order-service via HTTP (orderClient). Sans ce mock, les tests
// tentent de faire de vrais appels fetch() vers ORDER_SERVICE_URL qui est
// undefined en CI → "Failed to parse URL from undefined/internal/orders/..."
//
// Méthodes mockées :
//   findById    → createSession(), getPaymentStatus(), _triggerPostPaymentNotifications()
//   markAsPaid  → _handleCheckoutCompleted()
//   cancelOrder → _handleCheckoutExpired()
// -----------------------------------------------------------------------------
vi.mock('../clients/order.client.js', () => ({
    orderClient: {
        findById: vi.fn(),
        markAsPaid: vi.fn().mockResolvedValue({ success: true }),
        cancelOrder: vi.fn().mockResolvedValue({ success: true }),
    }
}));

// Le chemin doit pointer vers le client dans le monolith, pas dans l'order-service.
// vi.mock() ci-dessus intercepte cet import — pas de vrai appel HTTP en test.
import { paymentService } from '../services/payment.service.js';
import { orderClient } from '../clients/order.client.js';
import Stripe from 'stripe';

describe('PaymentService', () => {
    const { mockSessionCreate, mockConstructEvent } = Stripe.instanceMocks;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    // -------------------------------------------------------------------------
    // Test 1 : traitement d'un webhook Stripe checkout.session.completed
    //
    // payment.service._handleCheckoutCompleted() appelle orderClient.markAsPaid().
    // On vérifie que markAsPaid est appelé avec les bonnes données extraites
    // de l'event Stripe (orderId, provider, paymentIntentId, amount).
    // -------------------------------------------------------------------------
    it('devrait valider et mettre à jour la commande via webhook', async () => {
        const mockEvent = {
            type: 'checkout.session.completed',
            data: {
                object: {
                    metadata: { orderId: 'ord_123', isGuestCheckout: 'false' },
                    amount_total: 19999,
                    payment_intent: 'pi_test_456'
                }
            }
        };

        mockConstructEvent.mockReturnValue(mockEvent);

        // _triggerPostPaymentNotifications() appelle orderClient.findById()
        // pour récupérer les données de la commande après paiement.
        orderClient.findById.mockResolvedValue({
            id: 'ord_123',
            userId: 'user_abc',
            status: 'PAID',
            totalAmount: 199.99
        });

        const result = await paymentService.processStripeWebhook('body', 'sig');

        expect(result.received).toBe(true);

        // markAsPaid doit être appelé avec orderId + données Stripe
        expect(orderClient.markAsPaid).toHaveBeenCalledWith(
            'ord_123',
            expect.objectContaining({
                provider: 'STRIPE',
                paymentIntentId: 'pi_test_456',
                amount: 199.99
            })
        );
    });

    // -------------------------------------------------------------------------
    // Test 2 : création d'une session de paiement Stripe Checkout
    //
    // payment.service.createSession() appelle orderClient.findById()
    // pour lire la commande avant de créer la session Stripe.
    // -------------------------------------------------------------------------
    it('devrait créer une session de paiement', async () => {
        orderClient.findById.mockResolvedValue({
            id: 'ord_1',
            status: 'PENDING',
            totalAmount: 199.99,
            userId: 'user_abc',
            items: [{ name: 'Montre', price: 199.99, quantity: 1 }]
        });

        mockSessionCreate.mockResolvedValue({
            id: 'sess_123',
            url: 'https://checkout.stripe.com/pay/sess_123'
        });

        const session = await paymentService.createSession('ord_1');

        expect(session.id).toBe('sess_123');
        expect(mockSessionCreate).toHaveBeenCalled();
        // findById doit avoir été appelé avec le bon orderId
        expect(orderClient.findById).toHaveBeenCalledWith('ord_1');
    });
});