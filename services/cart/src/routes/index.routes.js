/**
 * @module Routes/Index
 *
 * Point d'entrée unique du routeur du cart-service.
 *
 * Deux périmètres :
 * - /api/v1/cart   → routes publiques authentifiées (rate limiter général)
 * - /internal      → routes inter-services (pas de rate limiter, protégées par X-Internal-Secret)
 */
import { Router } from 'express';
import { generalLimiter } from '../config/security.js';
import cartRoutes from './cart.routes.js';
import internalRoutes from './internal.routes.js';

const router = Router();

router.use('/api/v1/cart', generalLimiter, cartRoutes);

// Les routes internes ne passent pas par le Gateway — le rate limiter est superflu
router.use('/internal/cart', internalRoutes);

export default router;
