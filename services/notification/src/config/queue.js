/**
 * @module Config/Queue — notification-service
 *
 * Connexion Redis partagée pour BullMQ (IORedis).
 * Un seul client Redis est réutilisé par la Queue et le Worker
 * pour éviter la multiplication des connexions sur Upstash.
 *
 * Pourquoi IORedis et non le client Redis natif Node :
 * BullMQ nécessite IORedis pour ses opérations Lua atomiques (EVAL).
 * Le client natif `redis` de npm n'est pas compatible avec BullMQ.
 *
 * IMPORTANT — Isolation des clés BullMQ :
 * Le préfixe `{notification}` est configuré sur la Queue dans queue.service.js
 * et NON sur la connexion IORedis. BullMQ gère lui-même le namespacing via
 * l'option `prefix` de la Queue — passer `keyPrefix` à IORedis lève une
 * erreur au démarrage : "BullMQ: ioredis does not support ioredis prefixes".
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
