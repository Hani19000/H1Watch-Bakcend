/**
 * @module Config/Environment
 *
 * Source unique de vérité pour les variables d'environnement du notification-service.
 * Toutes les variables obligatoires sont validées au démarrage (fail-fast),
 * ce qui garantit qu'une variable manquante est détectée au lancement,
 * et non lors du traitement d'un job en production.
 */
import 'dotenv/config';

const requiredEnv = [
    'PORT',
    'REDIS_URL',                    // Upstash — connexion BullMQ (préfixe notification:)
    'DATABASE_URL',                 // Neon — schéma notification (log d'audit)
    'RESEND_API_KEY',               // Envoi d'emails transactionnels
    'INTERNAL_NOTIFICATION_SECRET', // Secret partagé avec les services consommateurs
];

// SENTRY_DSN optionnel en développement, obligatoire en production
if (process.env.NODE_ENV === 'production') {
    requiredEnv.push('SENTRY_DSN');
}

const missing = requiredEnv.filter((key) => !process.env[key]);

if (missing.length > 0) {
    console.error(
        `[FATAL] [notification-service] Variables d'environnement manquantes : ${missing.join(', ')}`
    );
    process.exit(1);
}

const isProduction = process.env.NODE_ENV === 'production';

export const ENV = Object.freeze({
    server: {
        port: Number(process.env.PORT) || 3007,
        nodeEnv: process.env.NODE_ENV || 'development',
        isProduction,
    },

    redis: {
        url: process.env.REDIS_URL,
    },

    database: {
        url: process.env.DATABASE_URL,
    },

    // Secret partagé avec auth/order/payment/cart pour sécuriser les appels internes
    internal: {
        notificationSecret: process.env.INTERNAL_NOTIFICATION_SECRET,
    },

    email: {
        apiKey: process.env.RESEND_API_KEY,
        fromEmail: process.env.RESEND_FROM_EMAIL || 'noreply@ecom-watch.fr',
        fromName: process.env.RESEND_FROM_NAME || 'ECOM-WATCH',
    },

    clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',

    sentry: {
        dsn: process.env.SENTRY_DSN,
        tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE) || 1.0,
    },

    cors: {
        origins: process.env.CORS_ORIGINS?.split(',').map((o) => o.trim()) || [],
    },

    queue: {
        // Nombre de jobs traités simultanément par le worker
        concurrency: Number(process.env.QUEUE_CONCURRENCY) || 5,
        // Durée de rétention des jobs réussis en ms (24h)
        removeOnCompleteAge: Number(process.env.QUEUE_REMOVE_ON_COMPLETE_AGE) || 86400,
        // Nombre max de tentatives avant qu'un job soit considéré comme mort
        maxAttempts: Number(process.env.QUEUE_MAX_ATTEMPTS) || 3,
    },
});
