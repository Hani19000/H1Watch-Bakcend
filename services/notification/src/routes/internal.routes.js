/**
 * @module Routes/Internal
 *
 * Endpoints exclusivement appelés par des services pairs (auth, order, payment, cart).
 * Ces routes ne sont jamais exposées via le Gateway Nginx.
 *
 * Sécurité : toutes les routes passent par `fromInternalService`
 * qui valide le header X-Internal-Secret par comparaison timing-safe.
 */
import { Router } from 'express';
import { fromInternalService } from '../middlewares/internal.middleware.js';
import { enqueueNotification, getQueueMetrics } from '../controllers/notification.controller.js';
import { enqueueLimiter } from '../config/security.js';

const router = Router();

/**
 * POST /internal/notifications/enqueue
 * Ajoute un job de notification dans la queue BullMQ.
 * Retourne 202 Accepted — le job sera traité de manière asynchrone.
 */
router.post('/enqueue', fromInternalService, enqueueLimiter, enqueueNotification);

/**
 * GET /internal/notifications/metrics
 * Métriques de la queue (waiting, active, failed, completed).
 * Utilisé pour le monitoring et les health checks approfondis.
 */
router.get('/metrics', fromInternalService, getQueueMetrics);

export default router;
