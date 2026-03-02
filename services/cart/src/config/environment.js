/**
 * @module Config/Environment
 *
 * Source unique de vérité pour les variables d'environnement du cart-service.
 *
 * STRATÉGIE DE VALIDATION :
 * - En production/développement : fail-fast au démarrage (process.exit) si une
 *   variable critique est manquante. Le service ne démarre pas.
 * - En test (NODE_ENV === 'test') : la validation est sautée entièrement.
 *   Toutes les dépendances (DB, Redis, product-service) sont mockées via vi.mock()
 *   dans les tests — les valeurs réelles ne sont jamais appelées. Valider ici
 *   casserait le chargement du module avant que Vitest ne puisse appliquer ses mocks.
 */
import 'dotenv/config';

const isTestEnv = process.env.NODE_ENV === 'test';

const requiredEnv = [
    'PORT',
    'JWT_ACCESS_SECRET',         // Vérification des access tokens émis par l'auth-service
    'DATABASE_URL',              // Connexion Neon (schéma cart)
    'REDIS_URL',                 // Upstash — cache des paniers
    'PRODUCT_SERVICE_URL',       // Appels HTTP vers product-service /internal/*
    'INTERNAL_PRODUCT_SECRET',   // Secret partagé avec le product-service
];

if (process.env.NODE_ENV === 'production') {
    requiredEnv.push('SENTRY_DSN');
}

// La validation fail-fast est désactivée en test : les dépendances sont toutes
// mockées et les valeurs réelles des variables ne sont jamais utilisées.
if (!isTestEnv) {
    const missing = requiredEnv.filter((key) => !process.env[key]);

    if (missing.length > 0) {
        console.error(
            `[FATAL] [cart-service] Variables d'environnement manquantes : ${missing.join(', ')}`
        );
        process.exit(1);
    }
}

const isProduction = process.env.NODE_ENV === 'production';

export const ENV = Object.freeze({
    server: {
        port: Number(process.env.PORT) || 3006,
        nodeEnv: process.env.NODE_ENV || 'development',
        isProduction,
    },

    database: {
        postgres: {
            // Fallback utilisé uniquement en test — jamais appelé car pg est mocké
            url: process.env.DATABASE_URL ?? 'postgresql://test:test@localhost:5432/test',
        },
        redis: {
            // Fallback utilisé uniquement en test — jamais appelé car redis est mocké
            url: process.env.REDIS_URL ?? 'redis://localhost:6379',
        },
    },

    jwt: {
        // Le cart-service valide les tokens, il n'en émet pas.
        accessTokenSecret: process.env.JWT_ACCESS_SECRET ?? 'test-secret',
    },

    // Communication vers le product-service
    services: {
        // Fallback utilisé uniquement en test — jamais appelé car productClient est mocké
        productServiceUrl: process.env.PRODUCT_SERVICE_URL ?? 'http://localhost:3003',
        httpTimeoutMs: Number(process.env.INTERNAL_HTTP_TIMEOUT_MS) || 5000,
    },

    // Secret partagé avec le product-service pour les appels /internal/*
    internal: {
        // Fallback utilisé uniquement en test — jamais appelé car productClient est mocké
        productSecret: process.env.INTERNAL_PRODUCT_SECRET ?? 'test-secret',
    },

    rateLimit: {
        windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
        max: Number(process.env.RATE_LIMIT_MAX) || 200,
    },

    cors: {
        origins: process.env.CORS_ORIGINS?.split(',').map((o) => o.trim()) || [],
    },

    // TTL du cache panier en secondes (24h — invalidé à chaque mutation)
    cache: {
        cartTtl: Number(process.env.CART_CACHE_TTL_SECONDS) || 86400,
    },
});