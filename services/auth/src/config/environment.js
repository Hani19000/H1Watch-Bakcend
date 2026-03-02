/**
 * @module Config/Environment — auth-service
 *
 * Source unique de vérité pour toutes les variables d'environnement.
 * Valide les variables critiques au démarrage (fail-fast) : une variable
 * manquante est détectée au lancement, pas lors d'une requête en production.
 */
import 'dotenv/config';

// ── Variables obligatoires ────────────────────────────────────────────────────

const requiredEnv = [
    'PORT',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'REDIS_URL',
    'CLIENT_URL',
    'ORDER_SERVICE_URL',
    'INTERNAL_AUTH_SECRET',          // X-Internal-Secret émis par ce service (order-service l'utilise)
    'INTERNAL_ADMIN_SECRET',         // Secret partagé avec l'admin-service (routes /internal/admin/*)
    'NOTIFICATION_SERVICE_URL',
    'INTERNAL_NOTIFICATION_SECRET',
];

// SENTRY_DSN optionnel en dev, obligatoire en prod
if (process.env.NODE_ENV === 'production') {
    requiredEnv.push('SENTRY_DSN');
}

// ── Validation PostgreSQL ─────────────────────────────────────────────────────
// Accepte soit DATABASE_URL (Neon/Cloud), soit les paramètres individuels (local Docker)

const hasPostgresConfig =
    process.env.DATABASE_URL ||
    (process.env.POSTGRES_HOST &&
        process.env.POSTGRES_USER &&
        process.env.POSTGRES_PASSWORD &&
        process.env.POSTGRES_DB);

// ── Vérification au démarrage ─────────────────────────────────────────────────

const missingEnv = requiredEnv.filter((key) => !process.env[key]);

if (missingEnv.length > 0 || !hasPostgresConfig) {
    const errorMsg =
        missingEnv.length > 0
            ? `[auth-service] Variables d'environnement manquantes : ${missingEnv.join(', ')}`
            : '[auth-service] Configuration PostgreSQL manquante (DATABASE_URL ou POSTGRES_*)';
    throw new Error(errorMsg);
}

// ── Export ────────────────────────────────────────────────────────────────────

const isProduction = process.env.NODE_ENV === 'production';

export const ENV = Object.freeze({
    server: {
        port: Number(process.env.PORT) || 3002,
        nodeEnv: process.env.NODE_ENV || 'development',
        isProduction,
    },

    database: {
        postgres: {
            url: process.env.DATABASE_URL,
            host: process.env.POSTGRES_HOST,
            port: Number(process.env.POSTGRES_PORT) || 5432,
            user: process.env.POSTGRES_USER,
            password: process.env.POSTGRES_PASSWORD,
            database: process.env.POSTGRES_DB,
        },
        redis: {
            url: process.env.REDIS_URL,
        },
    },

    jwt: {
        accessTokenSecret: process.env.JWT_ACCESS_SECRET,
        refreshTokenSecret: process.env.JWT_REFRESH_SECRET,
        accessTokenExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
        refreshTokenExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
    },

    // Secrets entrants : valident les appels reçus depuis d'autres services
    internal: {
        authSecret: process.env.INTERNAL_AUTH_SECRET,
        adminSecret: process.env.INTERNAL_ADMIN_SECRET,
        notificationServiceUrl: process.env.NOTIFICATION_SERVICE_URL,
        notificationSecret: process.env.INTERNAL_NOTIFICATION_SECRET,
        httpTimeoutMs: Number(process.env.INTERNAL_HTTP_TIMEOUT_MS) || 5000,
    },

    services: {
        orderServiceUrl: process.env.ORDER_SERVICE_URL,
    },

    // Valeurs lues par security.js — ne pas supprimer sans mettre à jour security.js.
    rateLimit: {
        windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 min
        max: Number(process.env.RATE_LIMIT_MAX) || 100,
        authWindowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
        authMax: Number(process.env.AUTH_RATE_LIMIT_MAX) || 5,
    },

    cors: {
        origins: process.env.CORS_ORIGINS?.split(',').map((o) => o.trim()) || [
            'http://localhost:5173',
        ],
    },

    clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',

    sentry: {
        dsn: process.env.SENTRY_DSN,
    },
});
