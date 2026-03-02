/**
 * @module Services/Cache
 *
 * Accès Redis pour la mise en cache des stats du dashboard admin.
 * TTL court (5 min) : données peu volatiles mais fraîcheur nécessaire.
 *
 * Préfixe `admin:` pour isoler les clés des autres services sur
 * la même instance Redis Upstash.
 *
 * CONNEXION AUTOMATIQUE : le client se connecte dès l'instanciation
 * pour être prêt avant la première requête HTTP.
 */
import { createClient } from 'redis';
import { ENV } from '../config/environment.js';
import { logError } from '../utils/logger.js';

class CacheService {
    #client = null;
    // Conservé pour exposer isReady() sans dépendre du client directement.
    #connected = false;

    constructor() {
        this.#client = createClient({ url: ENV.redis.url });

        this.#client.on('error', (err) => {
            this.#connected = false;
            // Ne pas crasher l'app si Redis est indisponible — les stats
            // seront recalculées à la prochaine requête sans cache.
            logError(err, { context: 'admin-service Redis error' });
        });

        this.#client.on('connect', () => {
            this.#connected = true;
        });

        this.#client.on('reconnecting', () => {
            this.#connected = false;
        });

        // Connexion immédiate au démarrage pour être prêt avant la première requête.
        this.#client.connect().catch((err) => {
            logError(err, { context: 'admin-service Redis connect at startup' });
        });
    }

    /** Préfixe toutes les clés pour isoler ce service des autres. */
    #key(rawKey) {
        return `${ENV.redis.prefix}${rawKey}`;
    }

    /**
     * Retourne null sans lever d'exception si Redis est fermé.
     * Le cache est un optimisation — son indisponibilité ne doit pas bloquer les stats.
     */
    async get(key) {
        try {
            const value = await this.#client.get(this.#key(key));
            return value ? JSON.parse(value) : null;
        } catch {
            return null;
        }
    }

    /**
     * Écrit en cache. En cas d'erreur Redis, l'échec est silencieux
     * pour ne pas bloquer la réponse HTTP.
     */
    async set(key, value, ttl = ENV.redis.statsTtl) {
        try {
            await this.#client.set(this.#key(key), JSON.stringify(value), { EX: ttl });
        } catch (err) {
            logError(err, { context: 'admin-service Redis set', key });
        }
    }

    async delete(key) {
        try {
            await this.#client.del(this.#key(key));
        } catch (err) {
            logError(err, { context: 'admin-service Redis delete', key });
        }
    }

    /** Exposé pour le health check uniquement. */
    isReady() {
        return this.#client.isReady;
    }
}

export const cacheService = new CacheService();
