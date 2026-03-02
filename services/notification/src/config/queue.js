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
 * Le préfixe `notification:` isole les clés BullMQ de celles des autres
 * services dans l'instance Redis partagée Upstash, exactement comme
 * les schémas Neon isolent les tables PostgreSQL.
 */
import IORedis from 'ioredis';
import { ENV } from './environment.js';

// maxRetriesPerRequest = null est requis par BullMQ pour bloquer les commandes
// de polling (BLPOP, BRPOP) sans timeout — comportement attendu pour un worker.
export const redisConnection = new IORedis(ENV.redis.url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    // Préfixe appliqué à toutes les clés pour isoler BullMQ des autres usages Redis
    keyPrefix: 'notification:',
});

redisConnection.on('connect', () => {
    console.info('[notification-service] Redis connecté (BullMQ)');
});

redisConnection.on('error', (err) => {
    console.error('[notification-service] Erreur Redis :', err.message);
});
