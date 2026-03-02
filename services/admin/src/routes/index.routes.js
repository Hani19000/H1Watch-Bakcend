/**
 * @module Routes/Index
 *
 * Point d'entrée unique du routeur du admin-service.
 */
import { Router } from 'express';
import { adminLimiter } from '../config/security.js';
import adminRoutes from './admin.routes.js';

const router = Router();

router.use('/api/v1/admin', adminLimiter, adminRoutes);

export default router;
