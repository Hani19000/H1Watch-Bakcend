/**
 * @module Services/Cache
 *
 * Accès Redis pour la mise en cache des stats du dashboard admin.
 * TTL court (5 min) : les données sont peu volatiles mais doivent
 * rester fraîches pour refléter l'activité récente.
 *
 * Préfixe `admin:` pour isoler les clés des autres services sur
 * la même instance Redis Upstash.
 */
import { createClient } from 'redis';
import { ENV } from '../config/environment.js';

class CacheService {
    #client = null;

    constructor() {
        this.#client = createClient({ url: ENV.redis.url });

        this.#client.on('error', (err) => {
            // Ne pas crasher l'app si Redis est indisponible — les stats
            // seront recalculées à la prochaine requête.
            console.error('[admin-service] Redis error:', err.message);
        });

        this.#client.on('connect', () => {
            console.log('[admin-service] Redis connecté');
        });
    }

    async connect() {
        await this.#client.connect();
    }

    /** Préfixe toutes les clés pour isoler ce service des autres. */
    #key(rawKey) {
        return `${ENV.redis.prefix}${rawKey}`;
    }

    async get(key) {
        const value = await this.#client.get(this.#key(key));
        return value ? JSON.parse(value) : null;
    }

    async set(key, value, ttl = ENV.redis.statsTtl) {
        await this.#client.set(this.#key(key), JSON.stringify(value), { EX: ttl });
    }

    async delete(key) {
        await this.#client.del(this.#key(key));
    }
}

export const cacheService = new CacheService();
