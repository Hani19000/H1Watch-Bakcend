/**
 * @module Service/Cache
 *
 * Encapsule l'accès à Redis avec sérialisation/désérialisation JSON automatique.
 * Singleton pour garantir une seule connexion Redis partagée dans l'application.
 *
 * Compatible Upstash (TLS requis) via `REDIS_URL` avec scheme `rediss://`.
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

    /**
     * Supprime plusieurs clés en une seule opération.
     * Utilisé pour invalider le cache d'un produit et toutes ses entrées de catalogue liées.
     */
    async deleteMany(keys) {
        if (!keys || keys.length === 0) return;
        await Promise.all(keys.map((key) => this.delete(key)));
    }
}

export const cacheService = new CacheService();