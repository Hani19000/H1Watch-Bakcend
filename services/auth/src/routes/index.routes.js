/**
 * @module Routes/Index — auth-service
 *
 * Point d'entrée unique du routeur de l'auth-service.
 *
 * DIFFÉRENCE PAR RAPPORT AU MONOLITHE :
 * Seules les routes /auth et /users sont montées ici.
 * Toutes les autres (products, orders, payments, etc.) sont
 * gérées par leurs services respectifs.
 *
 * Le rate limiter général est appliqué en tête pour couvrir
 * l'ensemble des routes du service sans double comptage.
 */

import { Router } from 'express';
import { generalLimiter } from '../config/security.js';
import authRoutes from './auth.routes.js';
import userRoutes from './users.routes.js';

const router = Router();

// Premier rempart contre le scraping et les attaques volumétriques.
// Les limiteurs spécifiques (authLimiter, passwordResetLimiter, etc.)
// s'appliquent en complément sur les routes sensibles.
router.use(generalLimiter);

router.use('/auth', authRoutes);
router.use('/users', userRoutes);

export default router;