/**
 * @module Service/Cache
 *
 * Encapsule l'accès à Redis avec sérialisation/désérialisation JSON automatique.
 * Singleton pour garantir une seule connexion Redis partagée dans l'application.
 *
 * Supporte REDIS_URL complète (Upstash, Redis Cloud, Render).
 * rediss:// → TLS activé (Upstash)
 * redis://  → sans TLS (local, Render interne)
 */
import { createClient } from 'redis';
import { logInfo, logError } from '../utils/logger.js';

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
    throw new Error('[auth-service] REDIS_URL manquante');
}

class CacheService {
    constructor() {
        if (CacheService.instance) return CacheService.instance;

        this.client = createClient({ url: redisUrl });

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

    async deleteMany(keys) {
        if (!keys || keys.length === 0) return;
        await Promise.all(keys.map((key) => this.delete(key)));
    }
}

export const cacheService = new CacheService();