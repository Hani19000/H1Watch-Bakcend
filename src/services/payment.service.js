/**
 * @module Service/Payment
 *
 * Gère la création des sessions de paiement Stripe et le traitement des webhooks.
 * Supporte le paiement en mode guest (sans compte) et authentifié.
 *
 * Responsabilités :
 * - Création de sessions Stripe Checkout
 * - Traitement des webhooks (paiement réussi, session expirée, échec)
 * - Vérification du statut de paiement
 *
 * Hors-scope (délégué à l'order-service via HTTP) :
 * - Lecture et mise à jour des commandes
 * - Annulation de commande et libération de stock
 * - Confirmation de la sortie de stock après paiement
 */
import { usersRepo } from '../repositories/index.js';
import { orderClient } from '../clients/order.client.js';
import { notificationService } from './notifications/notification.service.js';
import { AppError, ValidationError } from '../utils/appError.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { ORDER_STATUS } from '../constants/enums.js';
import Stripe from 'stripe';
import { ENV } from '../config/environment.js';
import { logError, logInfo } from '../utils/logger.js';

class PaymentService {
    constructor() {
        if (PaymentService.instance) return PaymentService.instance;

        if (!ENV.stripe?.secretKey) {
            throw new Error('CRITICAL: STRIPE_SECRET_KEY manquant dans la configuration.');
        }

        this.stripe = new Stripe(ENV.stripe.secretKey);
        PaymentService.instance = this;
        Object.freeze(this);
    }

    /**
     * Crée une session Stripe Checkout avec le montant global de la commande.
     * Délègue la lecture de la commande à l'order-service via HTTP.
     */
    async createSession(orderId, user = null) {
        // La commande (avec ses items) est lue depuis l'order-service
        const order = await orderClient.findById(orderId);

        if (!order) {
            throw new AppError('Commande introuvable', HTTP_STATUS.NOT_FOUND);
        }

        if (user && order.userId && order.userId !== user.id) {
            throw new AppError(
                'Vous ne pouvez pas payer une commande qui ne vous appartient pas',
                HTTP_STATUS.FORBIDDEN
            );
        }

        if (order.status === ORDER_STATUS.PAID) {
            throw new AppError('Cette commande a déjà été payée', HTTP_STATUS.BAD_REQUEST);
        }

        if (order.status === ORDER_STATUS.CANCELLED) {
            throw new AppError('Cette commande a été annulée', HTTP_STATUS.BAD_REQUEST);
        }

        const sessionConfig = {
            payment_method_types: ['card'],
            mode: 'payment',
            metadata: {
                orderId: order.id.toString(),
                orderNumber: order.orderNumber?.toString() || order.id.toString(),
                isGuestCheckout: user ? 'false' : 'true',
            },
            success_url: `${ENV.clientUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${ENV.clientUrl}/checkout/cancel?orderId=${order.id}`,
            line_items: [
                {
                    price_data: {
                        currency: 'eur',
                        product_data: {
                            name: `Commande #${order.orderNumber || order.id}`,
                            description: `${order.items?.length || 0} article(s)`,
                        },
                        unit_amount: Math.round(order.totalAmount * 100),
                    },
                    quantity: 1,
                },
            ],
        };

        if (!user) {
            sessionConfig.customer_creation = 'always';
            sessionConfig.customer_email = order.shippingAddress?.email || null;
        } else {
            const userData = await usersRepo.findById(user.id);
            if (userData?.email) {
                sessionConfig.customer_email = userData.email;
            }
        }

        const session = await this.stripe.checkout.sessions.create(sessionConfig);

        logInfo(`Session Stripe créée — orderId: ${orderId}, sessionId: ${session.id}`);

        return session;
    }

    /**
     * Traite les événements Stripe de façon sécurisée via vérification de signature HMAC.
     * La signature garantit que l'événement provient bien de Stripe et n'a pas été altéré.
     */
    async processStripeWebhook(rawBody, signature) {
        let event;

        try {
            event = this.stripe.webhooks.constructEvent(
                rawBody,
                signature,
                ENV.stripe?.webhookSecret
            );
        } catch (err) {
            throw new ValidationError(`Webhook signature verification failed: ${err.message}`);
        }

        switch (event.type) {
            case 'checkout.session.completed':
                await this._handleCheckoutCompleted(event.data.object);
                break;

            case 'checkout.session.expired':
                await this._handleCheckoutExpired(event.data.object);
                break;

            case 'payment_intent.payment_failed':
                await this._handlePaymentFailed(event.data.object);
                break;

            default:
                break;
        }

        return { received: true };
    }

    /**
     * Gère la finalisation d'une session de paiement réussie.
     * Délègue à l'order-service :
     *   - mise à jour du statut PAID
     *   - confirmation de stock (inventoryClient.confirmSale)
     */
    async _handleCheckoutCompleted(session) {
        const orderId = session.metadata.orderId;
        if (!orderId) return;

        try {
            await orderClient.markAsPaid(orderId, {
                provider: 'STRIPE',
                paymentIntentId: session.payment_intent,
                amount: session.amount_total / 100,
            });

            logInfo(`Paiement validé — orderId: ${orderId}`);

            // Notifications hors du flux principal pour ne pas bloquer Stripe.
            this._triggerPostPaymentNotifications(session, orderId).catch((err) =>
                logError(err, { context: 'PaymentService.triggerPostPaymentNotifications', orderId })
            );
        } catch (error) {
            logError(error, { context: 'PaymentService.handleCheckoutCompleted', orderId });
            throw error;
        }
    }

    /**
     * Libère le stock réservé lorsqu'une session Stripe expire sans paiement.
     * L'order-service gère la saga compensatoire (annulation + release stock).
     *
     * Déclencheurs :
     * - Stripe expire automatiquement la session après ~30 minutes d'inactivité
     * - L'utilisateur ferme l'onglet sans payer
     */
    async _handleCheckoutExpired(session) {
        const orderId = session.metadata?.orderId;
        if (!orderId) return;

        try {
            await orderClient.cancelOrder(orderId, 'checkout.session.expired');
            logInfo(`Commande annulée (session expirée) — orderId: ${orderId}`);
        } catch (error) {
            // Ne pas propager l'erreur : la session est déjà expirée côté Stripe.
            // Le cron de nettoyage prendra le relais si la commande reste PENDING.
            logError(error, { context: 'PaymentService.handleCheckoutExpired', orderId });
        }
    }

    async _handlePaymentFailed(paymentIntent) {
        const orderId = paymentIntent.metadata?.orderId;
        if (!orderId) return;
        // Pas d'action immédiate : Stripe retentera automatiquement.
        logInfo(`Paiement échoué — orderId: ${orderId}`);
    }

    /**
     * Récupère le statut de paiement d'une commande.
     * L'email est requis en mode guest comme second facteur d'authentification.
     */
    async getPaymentStatus(orderId, user = null, guestEmail = null) {
        const order = await orderClient.findById(orderId);

        if (!order) {
            throw new AppError('Commande introuvable', HTTP_STATUS.NOT_FOUND);
        }

        if (user) {
            if (order.userId && order.userId !== user.id) {
                logError(new Error("Tentative d'accès non autorisé"), { orderId, userId: user.id });
                throw new AppError(
                    'Accès interdit : Cette commande ne vous appartient pas',
                    HTTP_STATUS.FORBIDDEN
                );
            }
            return order.status || ORDER_STATUS.PENDING;
        }

        const orderEmail = order.shippingAddress?.email;

        if (!guestEmail || guestEmail.trim() === '') {
            throw new AppError(
                'Accès interdit : Email requis pour vérifier le statut',
                HTTP_STATUS.FORBIDDEN
            );
        }

        if (!orderEmail || orderEmail.trim() === '') {
            throw new AppError(
                'Erreur système : Email de commande introuvable',
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }

        if (guestEmail.trim().toLowerCase() !== orderEmail.trim().toLowerCase()) {
            throw new AppError(
                'Accès interdit : Email ne correspond pas',
                HTTP_STATUS.FORBIDDEN
            );
        }

        return order.status || ORDER_STATUS.PENDING;
    }

    async _sendGuestOrderConfirmation(email, orderData) {
        try {
            const { emailService } = await import('./notifications/email.service.js');
            const service = emailService?.sendOrderConfirmation ? emailService : emailService.default;
            await service.sendOrderConfirmation(email, orderData);
            logInfo(`Email de confirmation envoyé — orderId: ${orderData.id}`);
        } catch (error) {
            logError(error, { context: 'PaymentService.sendGuestOrderConfirmation', orderId: orderData.id });
        }
    }

    async _triggerPostPaymentNotifications(session, orderId) {
        const order = await orderClient.findById(orderId);
        const isGuestCheckout = session.metadata.isGuestCheckout === 'true';

        if (isGuestCheckout) {
            const customerEmail = session.customer_details?.email || session.customer_email;
            if (customerEmail) await this._sendGuestOrderConfirmation(customerEmail, order);
        } else if (order.userId) {
            const user = await usersRepo.findById(order.userId);
            if (user?.email) {
                await notificationService.notifyOrderPaid(user.email, order);
            } else {
                logError(
                    new Error('Email introuvable pour la notification utilisateur'),
                    { orderId, userId: order.userId }
                );
            }
        }
    }
}

export const paymentService = new PaymentService();