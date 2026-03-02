/**
 * @module Service/Queue
 *
 * Producteur BullMQ : ajoute des jobs de notification dans la queue Redis.
 * Ce service est le seul point d'entrée pour envoyer des jobs —
 * aucun autre fichier ne doit instancier Queue directement.
 *
 * Séparation Queue (producteur) / Worker (consommateur) :
 *   - La Queue est légère et partagée avec le serveur HTTP Express
 *   - Le Worker est lourd et potentiellement sur un process séparé
 *   - Cette séparation permet de scaler l'un sans l'autre
 */
import { Queue } from 'bullmq';
import { redisConnection } from '../config/queue.js';
import { QUEUE_NAMES } from '../constants/enums.js';
import { ENV } from '../config/environment.js';
import { logInfo, logError } from '../utils/logger.js';

class QueueService {
    constructor() {
        if (QueueService.instance) return QueueService.instance;

        this.queue = new Queue(QUEUE_NAMES.NOTIFICATIONS, {
            connection: redisConnection,
            defaultJobOptions: {
                // Backoff exponentiel pour limiter la pression sur Resend en cas d'erreur
                attempts: ENV.queue.maxAttempts,
                backoff: {
                    type: 'exponential',
                    delay: 2000, // 2s, 4s, 8s...
                },
                removeOnComplete: {
                    // Conserver l'historique des jobs réussis 24h pour le monitoring
                    age: ENV.queue.removeOnCompleteAge,
                    count: 1000,
                },
                removeOnFail: {
                    // Conserver les jobs échoués 7 jours pour investigation
                    age: 7 * 86400,
                },
            },
        });

        QueueService.instance = this;
        Object.freeze(this);
    }

    /**
     * Ajoute un job de notification dans la queue.
     *
     * @param {string} type    - Type de notification (NOTIFICATION_TYPES)
     * @param {string} to      - Email du destinataire
     * @param {object} data    - Données métier passées au template
     * @returns {Promise<Job>} - Job BullMQ créé
     */
    async enqueue(type, to, data) {
        try {
            const job = await this.queue.add(
                type,                // Nom du job = type de notification (lisible dans le dashboard BullMQ)
                { type, to, data },  // Payload transmis au worker
                {
                    // jobId déterministe pour éviter le doublon si un service
                    // envoie la même notification deux fois (idempotence légère)
                    jobId: `${type}:${to}:${data?.orderData?.id || data?.userData?.id || Date.now()}`,
                }
            );

            logInfo(`Job enqueued — id: ${job.id} | type: ${type} | to: ${to}`);
            return job;
        } catch (error) {
            logError(error, { context: 'QueueService.enqueue', type, to });
            throw error;
        }
    }

    /**
     * Retourne les métriques de la queue pour le health check.
     * Permet de détecter une accumulation anormale de jobs en attente.
     */
    async getMetrics() {
        const [waiting, active, failed, completed] = await Promise.all([
            this.queue.getWaitingCount(),
            this.queue.getActiveCount(),
            this.queue.getFailedCount(),
            this.queue.getCompletedCount(),
        ]);
        return { waiting, active, failed, completed };
    }
}

export const queueService = new QueueService();
