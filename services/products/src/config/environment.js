/**
 * @module Config/Environment — product-service
 *
 * Source unique de vérité pour toutes les variables d'environnement.
 * Valide les variables critiques au démarrage (fail-fast).
 */
import 'dotenv/config';

// ── Variables obligatoires ────────────────────────────────────────────────────

const requiredEnv = [
    'PORT',
    'JWT_ACCESS_SECRET',
    'REDIS_URL',
    'INTERNAL_PRODUCT_SECRET',   // Valide les appels depuis order-service, cart-service, payment-service
    'INTERNAL_ADMIN_SECRET',     // Valide les appels depuis l'admin-service (stats dashboard)
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
];

if (process.env.NODE_ENV === 'production') {
    requiredEnv.push('SENTRY_DSN');
}

const hasPostgresConfig =
    process.env.DATABASE_URL ||
    (process.env.POSTGRES_HOST &&
        process.env.POSTGRES_USER &&
        process.env.POSTGRES_PASSWORD &&
        process.env.POSTGRES_DB);

const missingEnv = requiredEnv.filter((key) => !process.env[key]);

if (missingEnv.length > 0 || !hasPostgresConfig) {
    const errorMsg =
        missingEnv.length > 0
            ? `[product-service] Variables d'environnement manquantes : ${missingEnv.join(', ')}`
            : '[product-service] Configuration PostgreSQL manquante';
    throw new Error(errorMsg);
}

// ── Export ────────────────────────────────────────────────────────────────────

const isProduction = process.env.NODE_ENV === 'production';

export const ENV = Object.freeze({
    server: {
        port: Number(process.env.PORT) || 3003,
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
    },

    // Secrets entrants : valident les appels reçus depuis d'autres services.
    // Chaque secret est associé à un seul service appelant.
    internalSecret: process.env.INTERNAL_PRODUCT_SECRET,   // order, cart, payment
    adminSecret: process.env.INTERNAL_ADMIN_SECRET,        // admin-service uniquement

    cloudinary: {
        cloudName: process.env.CLOUDINARY_CLOUD_NAME,
        apiKey: process.env.CLOUDINARY_API_KEY,
        apiSecret: process.env.CLOUDINARY_API_SECRET,
    },

    cors: {
        origins: process.env.CORS_ORIGINS?.split(',').map((o) => o.trim()) || [
            'http://localhost:5173',
        ],
    },

    sentry: {
        dsn: process.env.SENTRY_DSN,
    },
});
