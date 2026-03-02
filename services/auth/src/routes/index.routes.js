/**
 * @module Routes/Index — auth-service
 *
 * Point d'entrée unique du routeur de l'auth-service.
 *
 * PÉRIMÈTRES :
 *   /auth      → authentification (register, login, logout, refresh, reset)
 *   /users     → profil et données utilisateur authentifié
 *   /internal  → routes inter-services (X-Internal-Secret uniquement)
 *
 * DIFFÉRENCE PAR RAPPORT AU MONOLITHE :
 * Seules les routes /auth et /users sont exposées au public.
 * Les routes /internal ne sont jamais accessibles via le Gateway Nginx —
 * elles sont réservées aux appels depuis l'admin-service.
 *
 * RATE LIMITING :
 * generalLimiter couvre les routes publiques /auth et /users.
 * Les routes /internal sont protégées par X-Internal-Secret uniquement —
 * un rate limiter y serait contre-productif et bloquerait les crons légitimes.
 */
import { Router } from 'express';
import { generalLimiter } from '../config/security.js';
import authRoutes from './auth.routes.js';
import userRoutes from './users.routes.js';
import internalRoutes from './internal.routes.js';

const router = Router();

// Premier rempart contre le scraping et les attaques volumétriques.
// Les limiteurs spécifiques (authLimiter, passwordResetLimiter, etc.)
// s'appliquent en complément sur les routes sensibles.
router.use(generalLimiter);

router.use('/auth', authRoutes);
router.use('/users', userRoutes);

// Routes inter-services — pas de rate limiter, protégées par secret uniquement
router.use('/internal', internalRoutes);

export default router;
