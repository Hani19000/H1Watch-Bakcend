/**
 * @module Config/Queue
 *
 * Connexion Redis partagée pour BullMQ (IORedis).
 * Un seul client Redis est réutilisé par la Queue et le Worker
 * pour éviter la multiplication des connexions sur Upstash.
 *
 * Pourquoi IORedis et non le client Redis natif Node :
 * BullMQ nécessite IORedis pour ses opérations Lua atomiques (EVAL).
 * Le client natif `redis` de npm n'est pas compatible avec BullMQ.
 *
 * Pourquoi pas de keyPrefix ici :
 * BullMQ interdit l'option `keyPrefix` d'IORedis — il lève une erreur fatale
 * au démarrage si elle est présente. L'isolation des clés Redis est gérée par
 * l'option `prefix` passée à chaque Queue et Worker (voir queue.service.js
 * et notification.worker.js).
 */
import IORedis from 'ioredis';
import { ENV } from './environment.js';

// maxRetriesPerRequest = null est requis par BullMQ pour bloquer les commandes
// de polling (BLPOP, BRPOP) sans timeout — comportement attendu pour un worker.
export const redisConnection = new IORedis(ENV.redis.url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
});

redisConnection.on('connect', () => {
    console.info('[notification-service] Redis connecté (BullMQ)');
});

redisConnection.on('error', (err) => {
    console.error('[notification-service] Erreur Redis :', err.message);
});