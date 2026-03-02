/**
 * @module Service/Cache
 *
 * Encapsule l'accès à Redis pour le payment-service.
 * Utilisé principalement pour l'idempotence des webhooks Stripe :
 * Stripe peut renvoyer le même event plusieurs fois — Redis permet
 * de détecter et ignorer les doublons.
 *
 * Compatible Upstash via `REDIS_URL` avec scheme `rediss://`.
 */
import { createClient } from 'redis';
import { ENV } from '../config/environment.js';
import { logInfo, logError } from '../utils/logger.js';

class CacheService {
    constructor() {
        if (CacheService.instance) return CacheService.instance;

        this.client = createClient({ url: ENV.database.redis.url });

        this.client.on('error', (err) => logError(err, { context: 'Redis Client Error' }));
        this.client.on('connect', () => logInfo('Redis connecté avec succès'));

        this.connect();

        CacheService.instance = this;
    }

    async connect() {
        if (!this.client.isOpen) {
            await this.client.connect();
        }
    }

    async set(key, value, ttl = 3600) {
        await this.client.set(key, JSON.stringify(value), { EX: ttl });
    }

    async get(key) {
        const data = await this.client.get(key);
        return data ? JSON.parse(data) : null;
    }

    async delete(key) {
        await this.client.del(key);
    }
}

export const cacheService = new CacheService();