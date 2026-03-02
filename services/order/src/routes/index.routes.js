/**
 * @module Routes/Index
 * @service order-service
 *
 * Point d'entrée unique du routeur de l'order-service.
 *
 * PÉRIMÈTRES :
 *   /api/v1/orders    → cycle de vie des commandes (authentifié + guest)
 *   /api/v1/shipping  → frais de port et gestion des expéditions
 *   /api/v1/taxes     → taux de TVA et calculs fiscaux
 *   /internal         → routes inter-services (X-Internal-Secret uniquement)
 *
 * POURQUOI shipping ET taxes DANS L'ORDER-SERVICE :
 *   Ces calculs sont intrinsèquement liés à la commande — ordersService les
 *   appelle déjà en interne via #_calculateTotals. Les exposer ici évite
 *   la duplication de logique et respecte la séparation des responsabilités :
 *   l'order-service est propriétaire des calculs financiers de commande.
 *
 * RATE LIMITING :
 *   generalLimiter est appliqué ici sur toutes les routes publiques.
 *   Les routes /internal n'ont pas de rate limiter : protégées uniquement
 *   par X-Internal-Secret et jamais exposées au Gateway.
 */
import { Router } from 'express';
import { generalLimiter } from '../config/security.js';
import orderRoutes   from './order.routes.js';
import shippingRoutes from './shipping.routes.js';
import taxRoutes     from './tax.routes.js';
import internalRoutes from './internal.routes.js';

const router = Router();

// Routes commandes — authentifiées et guest
router.use('/api/v1/orders',   generalLimiter, orderRoutes);

// Routes frais de port — publiques + admin
router.use('/api/v1/shipping', generalLimiter, shippingRoutes);

// Routes taxes — publiques
router.use('/api/v1/taxes',    generalLimiter, taxRoutes);

// Routes inter-services — protégées par X-Internal-Secret uniquement
// Pas de rate limiter : ces routes ne sont jamais exposées via le Gateway.
router.use('/internal', internalRoutes);

export default router;
