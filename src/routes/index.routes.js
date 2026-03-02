/**
 * @module Routes/Index
 *
 * Point d'entrée unique du routeur monolith.
 *
 * Deux périmètres distincts :
 * - /api/v1/*   → routes publiques/auth (rate limiter général)
 * - /internal/* → routes inter-services (pas de rate limiter, protégées par X-Internal-Secret)
 *
 * Les routes /internal ne passent pas par le Gateway Nginx (bloquées en amont)
 * et ne sont accessibles qu'en réseau interne Render (service-to-service).
 */
import { Router } from 'express';
import { generalLimiter } from '../config/security.js';
import authRoutes from './auth.routes.js';
import userRoutes from './users.routes.js';
import productRoutes from './products.routes.js';
import categoryRoutes from './categories.routes.js';
import promotionRoutes from './promotions.routes.js';
import cartRoutes from './cart.routes.js';
// import orderRoutes from './order.routes.js';
import shippingRoutes from './shipping.routes.js';
import paymentRoutes from './payment.routes.js';
import inventoryRoutes from './inventory.routes.js';
import taxRoutes from './tax.routes.js';
import adminRoutes from './admin.routes.js';
import sitemapRoutes from './sitemap.routes.js';
import internalRoutes from './internal.routes.js';

const router = Router();

// ─────────────────────────────────────────────────────────────────────
// ROUTES PUBLIQUES ET AUTHENTIFIÉES
//
// Ce router est monté sous /api/v1 dans app.js (app.use('/api/v1', router)).
// Les chemins ici sont RELATIFS à ce préfixe — ne pas le répéter.
// Ex : router.use('/products') → accessible à /api/v1/products
// ─────────────────────────────────────────────────────────────────────

router.use(generalLimiter);

// router.use('/auth', authRoutes);
// router.use('/users', userRoutes);
// router.use('/products', productRoutes);
// router.use('/categories', categoryRoutes);
// router.use('/promotions', promotionRoutes);
router.use('/cart', cartRoutes);
// router.use('/orders', orderRoutes);
// router.use('/shipping', shippingRoutes);
router.use('/payments', paymentRoutes);
// router.use('/inventory', inventoryRoutes);
// router.use('/taxes', taxRoutes);
router.use('/admin', adminRoutes);
router.use('/', sitemapRoutes);

// ─────────────────────────────────────────────────────────────────────
// ROUTES INTER-SERVICES (sans rate limiter, protégées par X-Internal-Secret)
// Appelées uniquement par l'order-service — jamais exposées via Gateway.
// Accessible à /api/v1/internal/... depuis les autres services.
// ─────────────────────────────────────────────────────────────────────

router.use('/internal', internalRoutes);

export default router;