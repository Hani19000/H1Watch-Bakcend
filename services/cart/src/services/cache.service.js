/**
 * @module Service/Cache
 *
 * Encapsule l'accès à Redis pour le cart-service.
 * Pattern singleton — une seule connexion Redis partagée dans l'application.
 *
 * Le cache panier utilise un TTL long (24h) invalidé à chaque mutation,
 * car recalculer les totaux avec les données enrichies du product-service
 * à chaque lecture serait coûteux.
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
