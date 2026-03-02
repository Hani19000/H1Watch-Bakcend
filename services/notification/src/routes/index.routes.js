/**
 * @module Routes/Index
 *
 * Routeur racine du notification-service.
 * Monte les sous-routeurs sur leurs préfixes respectifs.
 */
import { Router } from 'express';
import internalRouter from './internal.routes.js';

const router = Router();

// Routes internes — protégées par X-Internal-Secret
router.use('/internal/notifications', internalRouter);

export default router;
