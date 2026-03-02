/**
 * @module Routes/Shipping
 * @service order-service
 *
 * SÉPARATION DES NIVEAUX D'ACCÈS :
 *
 *   Publiques (sans auth) :
 *     POST /calculate        → options de livraison pour le checkout guest
 *     POST /rates            → estimation legacy (compatibilité)
 *     GET  /track/:orderId   → suivi de commande (clients sans compte)
 *
 *   Admin uniquement :
 *     POST   /shipments/:orderId      → créer une expédition
 *     PATCH  /shipments/:shipmentId   → mettre à jour le suivi
 *
 * DIFFÉRENCE AVEC LE MONOLITH :
 *   Le monolith appliquait protect sur TOUTES les routes shipping (router.use(protect)).
 *   En microservice, /calculate et /track sont publiques pour les guests,
 *   conformément au flux de checkout sans compte.
 */
import { Router } from 'express';
import { shippingController } from '../controllers/shipping.controller.js';
import { protect } from '../middlewares/auth.middleware.js';
import { restrictTo } from '../middlewares/role.middleware.js';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIQUES — Accessibles sans authentification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/shipping/calculate
 * Calcule toutes les options disponibles (STANDARD, EXPRESS, RELAY)
 * pour un pays, un poids et un sous-total de panier donnés.
 * Applique automatiquement le franco si le seuil est atteint.
 */
router.post('/calculate', shippingController.calculateOptions);

/**
 * POST /api/v1/shipping/rates
 * Estimation legacy — conservée pour compatibilité frontend.
 * @deprecated Préférer /calculate pour les nouveaux développements.
 */
router.post('/rates', shippingController.getRates);

/**
 * GET /api/v1/shipping/track/:orderId
 * Suivi d'expédition par identifiant de commande.
 * Accessible publiquement pour les clients sans compte.
 */
router.get('/track/:orderId', shippingController.getTracking);

// ─────────────────────────────────────────────────────────────────────────────
// ADMINISTRATION — Réservées aux ADMIN
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/shipping/shipments/:orderId
 * Crée une expédition avec numéro de suivi automatique.
 * Requiert une commande au statut PAID.
 */
router.post('/shipments/:orderId', protect, restrictTo('ADMIN'), shippingController.createShipment);

/**
 * PATCH /api/v1/shipping/shipments/:shipmentId
 * Met à jour le statut et la localisation d'une expédition.
 * Un statut DELIVERED propage automatiquement DELIVERED à la commande.
 */
router.patch('/shipments/:shipmentId', protect, restrictTo('ADMIN'), shippingController.updateTracking);

export default router;
