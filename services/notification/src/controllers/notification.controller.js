/**
 * @module Controller/Notification
 *
 * Reçoit les requêtes d'enqueue depuis les services internes,
 * valide le payload, puis délègue à queueService.
 *
 * Responsabilité unique : valider l'entrée HTTP et répondre.
 * Aucune logique métier ici — tout est dans queueService et notificationService.
 */
import { queueService } from '../services/queue.service.js';
import { NOTIFICATION_TYPES } from '../constants/enums.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ValidationError } from '../utils/appError.js';

const VALID_TYPES = new Set(Object.values(NOTIFICATION_TYPES));

/**
 * POST /internal/notifications/enqueue
 *
 * Payload attendu :
 * {
 *   type: NOTIFICATION_TYPES,  // Type de notification (requis)
 *   to:   string,              // Email destinataire (requis)
 *   data: object               // Données métier pour le template (requis)
 * }
 */
export const enqueueNotification = asyncHandler(async (req, res) => {
    const { type, to, data } = req.body;

    if (!type || !to || !data) {
        throw new ValidationError('Les champs type, to et data sont requis');
    }

    if (!VALID_TYPES.has(type)) {
        throw new ValidationError(
            `Type de notification invalide. Valeurs acceptées : ${[...VALID_TYPES].join(', ')}`
        );
    }

    // Validation minimale de l'email — Resend lèvera une erreur plus précise si invalide
    if (typeof to !== 'string' || !to.includes('@')) {
        throw new ValidationError("Format d'email invalide");
    }

    const job = await queueService.enqueue(type, to, data);

    res.status(202).json({
        status: 'success',
        message: 'Notification mise en queue',
        data: { jobId: job.id },
    });
});

/**
 * GET /internal/notifications/metrics
 *
 * Retourne les métriques de la queue BullMQ.
 * Utile pour le monitoring et les alertes (Sentry, Grafana, etc.).
 */
export const getQueueMetrics = asyncHandler(async (_req, res) => {
    const metrics = await queueService.getMetrics();

    res.status(200).json({
        status: 'success',
        data: { queue: metrics },
    });
});
