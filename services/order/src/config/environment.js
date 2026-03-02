/**
 * @module Config/Environment
 *
 * Point d'entrée unique pour toutes les variables d'environnement
 * de l'order-service.
 *
 * Centraliser ici détecte les variables manquantes au démarrage (fail-fast)
 * plutôt qu'à l'exécution d'une requête.
 */
import 'dotenv/config';

// ── Variables obligatoires ────────────────────────────────────────────────────

const requiredEnv = [
    'PORT',
    'JWT_ACCESS_SECRET',          // Valider les tokens émis par l'auth-service
    'REDIS_URL',
    'CLIENT_URL',
    'MONOLITH_URL',               // Appels HTTP vers le monolith (paiement)
    'PRODUCT_SERVICE_URL',        // Appels HTTP vers /internal/inventory et /internal/variants
    'INTERNAL_PRODUCT_SECRET',    // Secret partagé avec le product-service (stock + variants)
    'INTERNAL_ORDER_SECRET',      // Secret partagé avec le monolith (payment webhook)
    'INTERNAL_AUTH_SECRET',       // Secret partagé avec l'auth-service (autoClaimGuestOrders)
    // Notification-service — emails transactionnels déportés (expédition, livraison, annulation)
    'NOTIFICATION_SERVICE_URL',
    'INTERNAL_NOTIFICATION_SECRET',
];

// SENTRY_DSN optionnel en développement, obligatoire en production
if (process.env.NODE_ENV === 'production') {
    requiredEnv.push('SENTRY_DSN');
}

// ── Validation PostgreSQL ─────────────────────────────────────────────────────

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
            ? `[order-service] Variables d'environnement manquantes : ${missingEnv.join(', ')}`
            : '[order-service] Configuration PostgreSQL manquante (DATABASE_URL ou POSTGRES_*)';
    throw new Error(errorMsg);
}

// ── Export ────────────────────────────────────────────────────────────────────

const isProduction = process.env.NODE_ENV === 'production';

export const ENV = Object.freeze({
    server: {
        port: Number(process.env.PORT) || 3004,
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
        // Le refresh secret n'est pas nécessaire ici : l'order-service
        // valide uniquement les access tokens, il n'émet pas de tokens.
        accessTokenSecret: process.env.JWT_ACCESS_SECRET,
        accessTokenExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
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

    // Communication inter-services (appels HTTP sortants)
    services: {
        monolithUrl: process.env.MONOLITH_URL,
        productServiceUrl: process.env.PRODUCT_SERVICE_URL,
        notificationServiceUrl: process.env.NOTIFICATION_SERVICE_URL,
        // Timeout en ms pour les appels HTTP vers les services externes.
        // En dessous, on préfère échouer vite et déclencher la saga compensatoire.
        httpTimeoutMs: Number(process.env.INTERNAL_HTTP_TIMEOUT_MS) || 5000,
    },

    // Secrets partagés pour valider les appels inter-services (header X-Internal-Secret)
    internal: {
        // Utilisé pour les appels entrants depuis le monolith (payment)
        orderSecret: process.env.INTERNAL_ORDER_SECRET,
        // Utilisé pour les appels entrants depuis l'auth-service
        authSecret: process.env.INTERNAL_AUTH_SECRET,
        // Utilisé pour les appels vers le product-service (inventory + variants)
        productSecret: process.env.INTERNAL_PRODUCT_SECRET,
        // Utilisé pour les appels vers le notification-service
        notificationSecret: process.env.INTERNAL_NOTIFICATION_SECRET,
    },

    cors: {
        origins: process.env.CORS_ORIGINS?.split(',').map((o) => o.trim()) || ['http://localhost:5173'],
    },

    clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',

    email: {
        apiKey: process.env.RESEND_API_KEY,
        fromEmail: process.env.RESEND_FROM_EMAIL || 'noreply@ecom-watch.local',
        fromName: process.env.RESEND_FROM_NAME || 'ECOM-WATCH',
    },

    // Durée en minutes avant qu'une commande PENDING soit considérée abandonnée
    orders: {
        expirationMinutes: Number(process.env.ORDER_EXPIRATION_MINUTES) || 30,
    },
});
