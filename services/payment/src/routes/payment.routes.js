/**
 * @module Routes/Payment
 *
 * Routes du payment-service.
 *
 * Pourquoi optionalAuth sur /create-session et /status :
 *   - Le checkout sans compte (guest) est un cas d'usage intentionnel.
 *   - Stripe collecte l'email du client — aucun compte requis.
 *   - Un utilisateur connecté bénéficie de la vérification de propriété côté service.
 *
 * Pourquoi le webhook Stripe n'a PAS de rate limiter :
 *   - Stripe peut renvoyer légitimement le même event plusieurs fois (at-least-once delivery).
 *   - Bloquer Stripe par rate limit casserait le flux de confirmation de paiement.
 *   - La sécurité est assurée par la vérification de signature HMAC (webhookSecret).
 *
 * IMPORTANT : rawBody est capturé dans app.js via express.json({ verify }).
 *   Ne pas ajouter express.raw() ici — cela casserait la capture du rawBody.
 *
 * ORDRE DES ROUTES (critique) :
 *   Routes statiques déclarées AVANT les routes paramétriques pour éviter
 *   que /success ou /cancel soient capturées comme valeurs de paramètre.
 */
import { Router } from 'express';
import { paymentController } from '../controllers/payment.controller.js';
import { optionalAuth } from '../middlewares/optionalAuth.middleware.js';
import { checkoutLimiter, statusLimiter } from '../config/security.js';
import { validateUUID } from '../utils/validation.js';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// 1. PAGES DE RETOUR STRIPE (routes statiques — déclarées EN PREMIER)
// Ces routes redirigent vers le frontend via une page HTML intermédiaire.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/payments/success?session_id=cs_...
 * Intermédiaire de redirection après paiement Stripe réussi.
 * Le session_id est validé (regex) avant injection dans le HTML pour prévenir le XSS.
 */
router.get('/success', paymentController.handleSuccess);

/**
 * GET /api/v1/payments/cancel
 * Intermédiaire de redirection après abandon du paiement.
 */
router.get('/cancel', paymentController.handleCancel);

// ─────────────────────────────────────────────────────────────────────────────
// 2. WEBHOOKS STRIPE (routes publiques — protégées par signature HMAC)
// Pas de rate limiter : Stripe doit pouvoir renvoyer ses events sans blocage.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/payments/webhook/stripe
 * Reçoit les events Stripe (checkout.session.completed, expired, payment_intent.failed).
 * La signature HMAC garantit l'authenticité — aucun JWT n'est nécessaire.
 */
router.post('/webhook/stripe', paymentController.handleStripeWebhook);

// ─────────────────────────────────────────────────────────────────────────────
// 3. ROUTES AVEC RATE LIMITER SPÉCIFIQUE (paramètre :orderId — en dernier)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/payments/create-session/:orderId
 * Crée une session Stripe Checkout pour une commande existante.
 * checkoutLimiter strict : une session Stripe a un coût — on limite la création en masse.
 */
router.post(
    '/create-session/:orderId',
    checkoutLimiter,
    optionalAuth,
    (req, _res, next) => {
        validateUUID(req.params.orderId, 'orderId');
        next();
    },
    paymentController.createCheckoutSession
);

/**
 * GET /api/v1/payments/status/:orderId
 * Vérifie le statut de paiement d'une commande (polling post-redirection Stripe).
 * statusLimiter souple : un client légitime peut poller quelques fois après redirection.
 * ?email= requis en mode guest comme second facteur de vérification.
 */
router.get(
    '/status/:orderId',
    statusLimiter,
    optionalAuth,
    (req, _res, next) => {
        validateUUID(req.params.orderId, 'orderId');
        next();
    },
    paymentController.checkStatus
);

export default router;
