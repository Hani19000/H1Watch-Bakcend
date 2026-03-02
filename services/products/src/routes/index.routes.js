/**
 * @module Routes/Index
 *
 * Point d'entrée unique du routeur du product-service.
 *
 * Deux périmètres :
 * - /api/v1/*    → routes publiques et admin (rate limiter)
 * - /internal/*  → routes inter-services (protégées par X-Internal-Secret)
 *
 * Le Gateway bloque /internal/* côté nginx — ces routes ne sont jamais
 * accessibles depuis Internet, uniquement en réseau interne Render.
 */
import { Router } from 'express';
import { generalLimiter } from '../config/security.js';
import productRoutes from './products.routes.js';
import inventoryRoutes from './inventory.routes.js';
import categoryRoutes from './categories.routes.js';
import promotionRoutes from './promotions.routes.js';
import internalRoutes from './internal.routes.js';
import internalAdminInventoryRoutes from './internal.admin.inventory.routes.js';

const router = Router();

// ─── Routes publiques et admin ───────────────────────────────────────────────
router.use('/api/v1/products', generalLimiter, productRoutes);
router.use('/api/v1/inventory', generalLimiter, inventoryRoutes);
router.use('/api/v1/categories', generalLimiter, categoryRoutes);
router.use('/api/v1/promotions', generalLimiter, promotionRoutes);

// ─── Routes inter-services (sans rate limiter) ───────────────────────────────

// Périmètre order-service, cart-service, payment-service
router.use('/internal', internalRoutes);

// Périmètre admin-service uniquement — secret distinct (INTERNAL_ADMIN_SECRET).
// Monter une instance Router séparée évite le bug Express de double-montage
// (un même Router monté deux fois corromprait la résolution des chemins).
router.use('/internal/admin', internalAdminInventoryRoutes);

export default router;