/**
 * @module Config/Environment
 *
 * Point d'entrée unique pour toutes les variables d'environnement
 * de l'auth-service.
 *
 * Centraliser ici permet de détecter les variables manquantes au démarrage
 * plutôt qu'à l'exécution d'une requête, et d'éviter les process.env éparpillés.
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
    'INTERNAL_AUTH_SECRET',
    // Notification-service — emails transactionnels déportés (welcome, password reset)
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
            port: Number(process.env.POSTGRES_PORT),
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
        accessTokenExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
        refreshTokenSecret: process.env.JWT_REFRESH_SECRET,
        refreshTokenExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
    },

    bcrypt: {
        iterations: Number(process.env.BCRYPT_ITERATIONS) || 100000,
        saltLength: Number(process.env.BCRYPT_SALT_LENGTH) || 16,
    },

    rateLimit: {
        windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
        max: Number(process.env.RATE_LIMIT_MAX) || 100,
        authWindowMs: Number(process.env.RATE_LIMIT_AUTH_WINDOW_MS) || 3600000,
        authMax: Number(process.env.RATE_LIMIT_AUTH_MAX) || 5,
    },

    sentry: {
        dsn: process.env.SENTRY_DSN,
        tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE) || 1.0,
    },

    // Communication inter-services
    services: {
        orderServiceUrl: process.env.ORDER_SERVICE_URL,
        internalSecret: process.env.INTERNAL_AUTH_SECRET,         // X-Internal-Secret exposé par ce service
        notificationServiceUrl: process.env.NOTIFICATION_SERVICE_URL,
        notificationSecret: process.env.INTERNAL_NOTIFICATION_SECRET, // X-Internal-Secret vers notification-service
        httpTimeoutMs: Number(process.env.INTERNAL_HTTP_TIMEOUT_MS) || 5000,
    },

    cors: {
        origins: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:5173'],
    },

    clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
});
