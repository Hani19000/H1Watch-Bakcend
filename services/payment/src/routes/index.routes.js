/**
 * @module Routes/Index
 *
 * Point d'entrée unique du routeur du payment-service.
 *
 * Un seul périmètre public exposé via le Gateway Nginx :
 *   /api/v1/payments → routes de paiement (Stripe sessions, webhooks, statut)
 *
 * Il n'y a pas de routes /internal sortantes dans ce service :
 * le payment-service appelle l'order-service (orderClient), il ne reçoit pas
 * d'appels inter-services entrants — toute la communication est initiée par lui.
 */
import { Router } from 'express';
import { generalLimiter } from '../config/security.js';
import paymentRoutes from './payment.routes.js';

const router = Router();

// Rate limiter global appliqué à toutes les routes de paiement.
// Les routes webhook disposent en plus de leur propre protection par signature HMAC.
router.use('/api/v1/payments', generalLimiter, paymentRoutes);

export default router;
