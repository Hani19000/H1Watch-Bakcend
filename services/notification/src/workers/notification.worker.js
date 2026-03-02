/**
 * @module Workers/Notification
 *
 * Consommateur BullMQ : traite les jobs de notification depuis la queue Redis.
 *
 * Pourquoi un worker séparé du serveur HTTP :
 *   - Le worker bloque sur Redis (BLPOP) — découpler évite de bloquer Express
 *   - En cas d'erreur du worker, le serveur HTTP reste disponible pour /health
 *   - Facilite le passage à un process séparé (worker threads) si la charge augmente
 *
 * Stratégie de retry (configurée dans queue.service.js) :
 *   - 3 tentatives maximum avec backoff exponentiel (2s, 4s, 8s)
 *   - Après 3 échecs, le job est déplacé dans la Dead Letter Queue BullMQ
 *   - Les jobs morts sont conservés 7 jours pour investigation
 */
import { Worker } from 'bullmq';
import { redisConnection } from '../config/queue.js';
import { notificationService } from '../services/notification.service.js';
import { notificationsRepo } from '../repositories/index.js';
import { QUEUE_NAMES } from '../constants/enums.js';
import { ENV } from '../config/environment.js';
import { logInfo, logError } from '../utils/logger.js';

/**
 * Crée et démarre le worker BullMQ.
 * Appelé depuis server.js après le démarrage du serveur HTTP.
 *
 * @returns {Worker} - Instance du worker pour pouvoir le fermer proprement
 */
export const startNotificationWorker = () => {
    const worker = new Worker(
        QUEUE_NAMES.NOTIFICATIONS,
        async (job) => {
            logInfo(`Worker — traitement job id: ${job.id} | type: ${job.data.type}`);

            // Délègue tout le traitement à notification.service
            // Le worker ne connaît pas les templates ni Resend
            await notificationService.process(job.data);

            logInfo(`Worker — job terminé id: ${job.id} | type: ${job.data.type}`);
        },
        {
            connection: redisConnection,
            concurrency: ENV.queue.concurrency,
        }
    );

    // ── Événements du worker ─────────────────────────────────────────────────

    worker.on('completed', (job) => {
        logInfo(`Worker — job réussi id: ${job.id} | type: ${job.data.type}`);

        // Log d'audit persistant — fire-and-forget pour ne pas bloquer le worker
        notificationsRepo.logSuccess({
            jobId:          job.id,
            type:           job.data.type,
            recipientEmail: job.data.to,
            attempts:       job.attemptsMade + 1,
        }).catch((err) =>
            logError(err, { context: 'notificationsRepo.logSuccess', jobId: job.id })
        );
    });

    worker.on('failed', (job, err) => {
        const isLastAttempt = job.attemptsMade >= (job.opts.attempts ?? ENV.queue.maxAttempts);

        logError(err, {
            context:      'NotificationWorker.failed',
            jobId:        job?.id,
            type:         job?.data?.type,
            to:           job?.data?.to,
            attemptsMade: job?.attemptsMade,
            isFinal:      isLastAttempt,
        });

        // On ne log en base qu'à l'épuisement des tentatives.
        // Les tentatives intermédiaires sont gérées exclusivement par BullMQ.
        if (isLastAttempt) {
            notificationsRepo.logFailure({
                jobId:          job.id,
                type:           job.data.type,
                recipientEmail: job.data.to,
                attempts:       job.attemptsMade,
                errorMessage:   err?.message,
            }).catch((dbErr) =>
                logError(dbErr, { context: 'notificationsRepo.logFailure', jobId: job?.id })
            );
        }
    });

    worker.on('error', (err) => {
        // Erreur de connexion Redis — le worker réessaiera automatiquement
        logError(err, { context: 'NotificationWorker.error (Redis connection)' });
    });

    worker.on('stalled', (jobId) => {
        // Un job est "stalled" si le worker crashe pendant son traitement.
        // BullMQ le requeue automatiquement — on log pour le monitoring.
        logError(new Error(`Job stalled — id: ${jobId}`), { context: 'NotificationWorker.stalled' });
    });

    logInfo(`Worker notification démarré — concurrence: ${ENV.queue.concurrency}`);

    return worker;
};
