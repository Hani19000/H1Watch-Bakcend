/**
 * @module Routes/Index — auth-service
 *
 * Point d'entrée unique du routeur de l'auth-service.
 *
 * PÉRIMÈTRES :
 *   /auth      → authentification (login, register, refresh, logout, reset)
 *   /users     → profil utilisateur + administration des comptes (JWT requis)
 *   /internal  → routes inter-services (X-Internal-Secret uniquement, jamais via Gateway)
 *
 * RATE LIMITING :
 *   generalLimiter est appliqué sur les routes publiques /auth et /users.
 *   Les routes /internal n'ont pas de rate limiter : protégées par secret partagé
 *   et jamais exposées au réseau public.
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
router.use('/auth', generalLimiter, authRoutes);
router.use('/users', generalLimiter, userRoutes);

// Routes inter-services — pas de rate limiter, protégées par X-Internal-Secret.
router.use('/internal/admin', internalRoutes);

export default router;
