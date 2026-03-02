/**
 * @module Config/Environment
 *
 * Point d'entrée unique pour toutes les variables d'environnement.
 * Valide les variables critiques au démarrage (fail-fast) plutôt
 * qu'à l'exécution d'une requête.
 */
import 'dotenv/config';

// ── Variables obligatoires ────────────────────────────────────────────────────

const requiredEnv = [
    'PORT',
    'JWT_ACCESS_SECRET',        // Valider les access tokens de l'auth-service
    'REDIS_URL',                // Cache Redis — stats dashboard (TTL 5 min)
    'AUTH_SERVICE_URL',         // Appels vers /internal/admin/* de l'auth-service
    'ORDER_SERVICE_URL',        // Appels vers /internal/admin/* de l'order-service
    'PRODUCT_SERVICE_URL',      // Appels vers /internal/* du product-service
    'INTERNAL_ADMIN_SECRET',    // Secret envoyé dans X-Internal-Secret (appels sortants)
];

// SENTRY_DSN optionnel en dev, obligatoire en prod
if (process.env.NODE_ENV === 'production') {
    requiredEnv.push('SENTRY_DSN');
}

const missingEnv = requiredEnv.filter((key) => !process.env[key]);

if (missingEnv.length > 0) {
    throw new Error(
        `[admin-service] Variables d'environnement manquantes : ${missingEnv.join(', ')}`
    );
}

// ── Export ────────────────────────────────────────────────────────────────────

const isProduction = process.env.NODE_ENV === 'production';

export const ENV = Object.freeze({
    server: {
        port: Number(process.env.PORT) || 3008,
        nodeEnv: process.env.NODE_ENV || 'development',
        isProduction,
    },

    redis: {
        url: process.env.REDIS_URL,
        // Préfixe isolé pour éviter les collisions avec les autres services
        prefix: 'admin:',
        // TTL en secondes pour les stats du dashboard (données peu volatiles)
        statsTtl: Number(process.env.ADMIN_STATS_TTL_SECONDS) || 300,
    },

    jwt: {
        // Valide uniquement les access tokens — n'émet aucun token
        accessTokenSecret: process.env.JWT_ACCESS_SECRET,
    },

    services: {
        authServiceUrl: process.env.AUTH_SERVICE_URL,
        orderServiceUrl: process.env.ORDER_SERVICE_URL,
        productServiceUrl: process.env.PRODUCT_SERVICE_URL,
        // Timeout pour les appels HTTP inter-services
        httpTimeoutMs: Number(process.env.INTERNAL_HTTP_TIMEOUT_MS) || 5000,
    },

    internal: {
        // Secret envoyé dans X-Internal-Secret pour s'authentifier auprès
        // de chaque service partenaire (auth, order, product)
        adminSecret: process.env.INTERNAL_ADMIN_SECRET,
    },

    rateLimit: {
        windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
        // Routes admin : faible volume, limite généreuse pour les tableaux de bord
        max: Number(process.env.RATE_LIMIT_MAX) || 200,
    },

    cors: {
        origins: process.env.CORS_ORIGINS?.split(',').map((o) => o.trim()) || [
            'http://localhost:5173',
        ],
    },
});
