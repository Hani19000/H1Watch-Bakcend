/**
 * @module Service/Payment
 *
 * Orchestre les sessions de paiement Stripe et le traitement des webhooks.
 * Supporte le paiement en mode guest (sans compte) et authentifié.
 *
 * Responsabilités de ce service :
 *   - Créer les sessions Stripe Checkout
 *   - Traiter les webhooks Stripe (paiement réussi, expiré, échec)
 *   - Vérifier le statut de paiement d'une commande
 *   - Persister les tentatives de paiement dans payment.payments
 *   - Garantir l'idempotence des webhooks via Redis
 *
 * Hors-scope (délégué à d'autres services) :
 *   - Lecture et mise à jour des commandes → orderClient (HTTP)
 *   - Récupération des données utilisateur → payload JWT (pas de DB auth)
 *   - Envoi d'emails → notificationClient (HTTP, fire-and-forget)
 *
 * Pourquoi pas d'appel vers usersRepo :
 *   Le payment-service est stateless vis-à-vis des utilisateurs.
 *   L'email est résolu depuis : (1) le payload JWT, (2) les données Stripe,
 *   (3) l'adresse de livraison. Ce découplage évite une dépendance au schéma auth.
 */
import Stripe from 'stripe';
import { ENV } from '../config/environment.js';
import { orderClient } from '../clients/order.client.js';
import { notificationClient } from '../clients/notification.client.js';
import { paymentsRepo } from '../repositories/index.repo.js';
import { cacheService } from './cache.service.js';
import { AppError, ValidationError } from '../utils/appError.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { ORDER_STATUS, PAYMENT_STATUS } from '../constants/enums.js';
import { logInfo, logError } from '../utils/logger.js';

// Durée de rétention d'un event webhook dans Redis pour l'idempotence.
// 24h est suffisant : Stripe ne retente pas au-delà de quelques heures.
const WEBHOOK_IDEMPOTENCY_TTL_SECONDS = 86400;

class PaymentService {
    constructor() {
        if (PaymentService.instance) return PaymentService.instance;

        if (!ENV.stripe?.secretKey) {
            throw new Error('[payment-service] CRITICAL: STRIPE_SECRET_KEY manquant.');
        }

        this.stripe = new Stripe(ENV.stripe.secretKey, {
            // Fixer la version de l'API Stripe pour des réponses prévisibles.
            apiVersion: '2024-06-20',
        });

        PaymentService.instance = this;
        Object.freeze(this);
    }

    // =========================================================================
    // CRÉATION DE SESSION
    // =========================================================================

    /**
     * Crée une session Stripe Checkout pour une commande existante.
     *
     * L'email pré-rempli dans Stripe réduit la friction pour l'utilisateur
     * et est utilisé par Stripe pour les reçus automatiques.
     *
     * Résolution de l'email client :
     *   - Mode authentifié → req.user.email (extrait du JWT par optionalAuth)
     *   - Mode guest        → order.shippingAddress.email (collecté lors du checkout)
     *
     * @param {string}      orderId  - UUID de la commande (validé côté route)
     * @param {object|null} user     - Payload JWT hydraté par optionalAuth, ou null
     */
    async createSession(orderId, user = null) {
        const order = await orderClient.findById(orderId);

        if (!order) {
            throw new AppError('Commande introuvable', HTTP_STATUS.NOT_FOUND);
        }

        // En mode authentifié, on vérifie la propriété de la commande.
        // En mode guest, toute personne avec l'orderId peut payer — Stripe collecte l'email.
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

        const customerEmail = this._resolveCustomerEmail(user, order);

        const sessionConfig = this._buildSessionConfig(order, customerEmail, user);
        const session = await this.stripe.checkout.sessions.create(sessionConfig);

        // Enregistrement de la tentative pour la traçabilité et le support client.
        // Le payment_intent peut être null à ce stade — Stripe le fournit après paiement.
        await paymentsRepo.create({
            orderId: order.id,
            provider: 'STRIPE',
            paymentIntentId: session.payment_intent ?? null,
            sessionId: session.id,
            amount: order.totalAmount,
            currency: 'EUR',
        });

        logInfo(`Session Stripe créée — orderId: ${orderId}, sessionId: ${session.id}`);

        return session;
    }

    // =========================================================================
    // TRAITEMENT DES WEBHOOKS
    // =========================================================================

    /**
     * Valide la signature Stripe et dispatche l'event vers le handler approprié.
     *
     * La vérification de signature HMAC garantit que l'event provient de Stripe
     * et n'a pas été altéré en transit. Elle nécessite le rawBody original
     * capturé dans app.js via express.json({ verify }).
     *
     * @param {Buffer} rawBody   - Corps brut de la requête (avant parsing JSON)
     * @param {string} signature - Header stripe-signature de la requête
     */
    async processStripeWebhook(rawBody, signature) {
        let event;

        try {
            event = this.stripe.webhooks.constructEvent(
                rawBody,
                signature,
                ENV.stripe.webhookSecret
            );
        } catch (err) {
            // Ne pas exposer le message Stripe brut pour ne pas aider un attaquant
            // à comprendre pourquoi sa tentative a échoué.
            logError(err, { context: 'PaymentService.processStripeWebhook — signature invalide' });
            throw new ValidationError('Signature webhook invalide');
        }

        // L'idempotence garantit que le double-traitement d'un event Stripe
        // (relance automatique Stripe) n'entraîne pas de double mise à jour de statut.
        const isAlreadyProcessed = await this._isEventAlreadyProcessed(event.id);
        if (isAlreadyProcessed) {
            logInfo(`Webhook Stripe ignoré (déjà traité) — eventId: ${event.id}`);
            return { received: true };
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
                // On acquitte silencieusement les events non gérés pour éviter
                // que Stripe retente indéfiniment et pollue les logs.
                logInfo(`Webhook Stripe — event ignoré : ${event.type}`);
        }

        // Marquer l'event comme traité après succès pour l'idempotence.
        await this._markEventAsProcessed(event.id);

        return { received: true };
    }

    // =========================================================================
    // VÉRIFICATION DU STATUT
    // =========================================================================

    /**
     * Retourne le statut de paiement d'une commande.
     *
     * Contrôle d'accès :
     *   - Utilisateur authentifié → vérification de propriété via order.userId
     *   - Guest → vérification timing-safe par email (second facteur)
     *
     * @param {string}      orderId     - UUID de la commande
     * @param {object|null} user        - Payload JWT ou null (guest)
     * @param {string|null} guestEmail  - Email fourni par le guest (?email=)
     */
    async getPaymentStatus(orderId, user = null, guestEmail = null) {
        const order = await orderClient.findById(orderId);

        if (!order) {
            throw new AppError('Commande introuvable', HTTP_STATUS.NOT_FOUND);
        }

        if (user) {
            if (order.userId && order.userId !== user.id) {
                logError(new Error("Tentative d'accès non autorisé au statut de paiement"), {
                    orderId,
                    userId: user.id,
                });
                throw new AppError(
                    'Accès interdit : cette commande ne vous appartient pas',
                    HTTP_STATUS.FORBIDDEN
                );
            }
            return order.status || ORDER_STATUS.PENDING;
        }

        // Mode guest : l'email est le seul facteur de vérification disponible.
        this._verifyGuestEmailAccess(guestEmail, order.shippingAddress?.email);

        return order.status || ORDER_STATUS.PENDING;
    }

    // =========================================================================
    // HANDLERS PRIVÉS — WEBHOOKS
    // =========================================================================

    /**
     * Traite la finalisation d'un paiement réussi.
     *
     * Délègue à l'order-service :
     *   - Mise à jour du statut → PAID
     *   - Confirmation de stock (saga inventoryClient côté order-service)
     *
     * Les notifications sont fire-and-forget pour ne pas bloquer Stripe.
     * Stripe attend une réponse 200 dans les 30 secondes — toute latence risque
     * une relance automatique.
     */
    async _handleCheckoutCompleted(session) {
        const orderId = session.metadata?.orderId;
        if (!orderId) {
            logError(new Error('Webhook completed sans orderId dans metadata'), {
                context: 'PaymentService._handleCheckoutCompleted',
                sessionId: session.id,
            });
            return;
        }

        try {
            await orderClient.markAsPaid(orderId, {
                provider: 'STRIPE',
                paymentIntentId: session.payment_intent,
                amount: session.amount_total / 100,
            });

            // Mise à jour du statut local dans payment.payments
            if (session.payment_intent) {
                await paymentsRepo.updateStatusByIntentId(
                    session.payment_intent,
                    PAYMENT_STATUS.SUCCESS
                );
            }

            logInfo(`Paiement validé — orderId: ${orderId}`);

            // Notifications hors du flux principal (fire-and-forget).
            this._dispatchPostPaymentNotifications(session, orderId).catch((err) =>
                logError(err, {
                    context: 'PaymentService._dispatchPostPaymentNotifications',
                    orderId,
                })
            );
        } catch (error) {
            logError(error, { context: 'PaymentService._handleCheckoutCompleted', orderId });
            // On propage l'erreur pour que Stripe reçoive un 500 et relance l'event.
            throw error;
        }
    }

    /**
     * Libère le stock réservé lorsqu'une session Stripe expire sans paiement.
     * L'order-service gère la saga compensatoire (annulation + release stock).
     *
     * On n'utilise pas throw ici car la session est déjà expirée côté Stripe :
     * renvoyer un 500 déclencherait des relances inutiles.
     */
    async _handleCheckoutExpired(session) {
        const orderId = session.metadata?.orderId;
        if (!orderId) return;

        try {
            await orderClient.cancelOrder(orderId, 'checkout.session.expired');

            if (session.payment_intent) {
                await paymentsRepo.updateStatusByIntentId(
                    session.payment_intent,
                    PAYMENT_STATUS.FAILED
                );
            }

            logInfo(`Commande annulée (session expirée) — orderId: ${orderId}`);

            // Notification d'expiration fire-and-forget — non bloquant.
            this._dispatchSessionExpiredNotification(session, orderId).catch((err) =>
                logError(err, {
                    context: 'PaymentService._dispatchSessionExpiredNotification',
                    orderId,
                })
            );
        } catch (error) {
            // Le cron de nettoyage de l'order-service prendra le relais si
            // la commande reste PENDING après expiration de la session.
            logError(error, { context: 'PaymentService._handleCheckoutExpired', orderId });
        }
    }

    /**
     * Log l'échec de paiement pour le monitoring.
     * Pas d'action immédiate : Stripe gère les relances automatiquement.
     */
    async _handlePaymentFailed(paymentIntent) {
        const orderId = paymentIntent.metadata?.orderId;

        if (paymentIntent.id) {
            await paymentsRepo.updateStatusByIntentId(
                paymentIntent.id,
                PAYMENT_STATUS.FAILED
            ).catch((err) =>
                logError(err, { context: 'paymentsRepo.updateStatusByIntentId (failed)', orderId })
            );
        }

        logInfo(`Paiement échoué — orderId: ${orderId || 'inconnu'}`);
    }

    // =========================================================================
    // NOTIFICATIONS PRIVÉES — Délégation vers le notification-service
    // =========================================================================

    /**
     * Résout l'email du destinataire à partir des données disponibles.
     * Priorité à l'email Stripe (plus fiable car validé lors du paiement),
     * puis fallback sur l'adresse de livraison.
     *
     * @private
     * @param {object} stripeSession - Session Stripe (checkout.session.completed/expired)
     * @param {object} order         - Données de la commande
     * @returns {string|null}
     */
    _resolveNotificationEmail(stripeSession, order) {
        return (
            stripeSession?.customer_details?.email ||
            stripeSession?.customer_email ||
            order?.shippingAddress?.email ||
            null
        );
    }

    /**
     * Déclenche la confirmation de commande après paiement validé.
     * Fire-and-forget : ne bloque pas le traitement du webhook Stripe.
     */
    async _dispatchPostPaymentNotifications(session, orderId) {
        const order = await orderClient.findById(orderId);

        const email = this._resolveNotificationEmail(session, order);

        if (!email) {
            logError(
                new Error('Email introuvable pour la notification de confirmation de paiement'),
                { context: 'PaymentService._dispatchPostPaymentNotifications', orderId }
            );
            return;
        }

        notificationClient.notifyOrderConfirmation(email, order);

        logInfo(`Notification paiement confirmé envoyée — orderId: ${orderId}`);
    }

    /**
     * Déclenche la notification d'expiration de session.
     * Fire-and-forget : ne bloque pas le traitement du webhook Stripe.
     */
    async _dispatchSessionExpiredNotification(session, orderId) {
        const order = await orderClient.findById(orderId);

        const email = this._resolveNotificationEmail(session, order);

        if (!email) {
            // L'absence d'email sur une session expirée n'est pas critique — on log et on continue.
            logInfo(`Session expirée sans email résolvable — orderId: ${orderId}`);
            return;
        }

        notificationClient.notifyOrderCancelled(email, order, 'checkout.session.expired');

        logInfo(`Notification session expirée envoyée — orderId: ${orderId}`);
    }

    // =========================================================================
    // UTILITAIRES PRIVÉS
    // =========================================================================

    /**
     * Construit la configuration de la session Stripe Checkout.
     * Factorisé pour garder createSession lisible.
     */
    _buildSessionConfig(order, customerEmail, user) {
        const config = {
            payment_method_types: ['card'],
            mode: 'payment',
            metadata: {
                orderId: order.id.toString(),
                orderNumber: order.orderNumber?.toString() || order.id.toString(),
                isGuestCheckout: user ? 'false' : 'true',
            },
            // Les URLs de retour pointent vers le payment-service lui-même,
            // qui affiche une page HTML intermédiaire avant de rediriger vers le frontend.
            // PAYMENT_SERVICE_URL est l'URL publique du service (ex: https://payment.onrender.com).
            success_url: `${ENV.services.paymentServiceUrl}/api/v1/payments/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${ENV.services.paymentServiceUrl}/api/v1/payments/cancel?orderId=${order.id}`,
            line_items: [
                {
                    price_data: {
                        currency: 'eur',
                        product_data: {
                            name: `Commande #${order.orderNumber || order.id}`,
                            description: `${order.items?.length || 0} article(s)`,
                        },
                        // Stripe travaille en centimes — conversion depuis euros
                        unit_amount: Math.round(order.totalAmount * 100),
                    },
                    quantity: 1,
                },
            ],
        };

        if (customerEmail) {
            config.customer_email = customerEmail;
        }

        // customer_creation force la création d'un client Stripe pour les guests
        // afin que Stripe puisse envoyer ses reçus automatiques.
        if (!user) {
            config.customer_creation = 'always';
        }

        return config;
    }

    /**
     * Résout l'email du client pour pré-remplir la page Stripe Checkout.
     * Améliore l'expérience utilisateur et réduit la friction de paiement.
     *
     * Priorité :
     *   1. Mode authentifié → email extrait du JWT par optionalAuth
     *   2. Mode guest       → email de l'adresse de livraison (saisi lors du checkout)
     */
    _resolveCustomerEmail(user, order) {
        return user?.email || order.shippingAddress?.email || null;
    }

    /**
     * Vérifie l'email guest par comparaison insensible à la casse.
     * Lance une AppError 403 si l'email ne correspond pas.
     *
     * Note : on utilise une comparaison simple (toLowerCase) et non timing-safe
     * car l'email est déjà normalisé dans la DB et n'est pas un secret cryptographique.
     * Si le risque d'énumération est préoccupant, un rate limiter IP est déjà présent
     * sur la route /status via statusLimiter.
     */
    _verifyGuestEmailAccess(providedEmail, orderEmail) {
        if (!providedEmail || providedEmail.trim() === '') {
            throw new AppError(
                'Email requis pour vérifier le statut en mode guest',
                HTTP_STATUS.FORBIDDEN
            );
        }

        if (!orderEmail || orderEmail.trim() === '') {
            throw new AppError(
                'Erreur système : email de commande introuvable',
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }

        if (providedEmail.trim().toLowerCase() !== orderEmail.trim().toLowerCase()) {
            throw new AppError(
                "Accès interdit : l'email ne correspond pas à la commande",
                HTTP_STATUS.FORBIDDEN
            );
        }
    }

    /**
     * Vérifie si un event Stripe a déjà été traité (idempotence Redis).
     * Stripe garantit at-least-once delivery — les doublons sont fréquents.
     */
    async _isEventAlreadyProcessed(eventId) {
        try {
            const cached = await cacheService.get(`stripe_event:${eventId}`);
            return cached !== null;
        } catch (err) {
            // En cas d'indisponibilité Redis, on laisse passer l'event
            // plutôt que de bloquer le traitement du webhook.
            logError(err, { context: 'PaymentService._isEventAlreadyProcessed', eventId });
            return false;
        }
    }

    /**
     * Marque un event Stripe comme traité dans Redis.
     */
    async _markEventAsProcessed(eventId) {
        try {
            await cacheService.set(
                `stripe_event:${eventId}`,
                { processedAt: new Date().toISOString() },
                WEBHOOK_IDEMPOTENCY_TTL_SECONDS
            );
        } catch (err) {
            // Non bloquant : une erreur Redis ici ne doit pas faire échouer le webhook.
            logError(err, { context: 'PaymentService._markEventAsProcessed', eventId });
        }
    }
}

export const paymentService = new PaymentService();
