/**
 * @module App
 *
 * Point d'entrée Express de l'auth-service.
 *
 * RESPONSABILITÉS DU MICROSERVICE :
 * - Port dynamique (géré par Render via process.env.PORT)
 * - Aucune gestion de fichiers statiques (images, assets)
 * - Aucun parsing spécifique (rawBody pour webhooks)
 * - Périmètre strict : routes /auth et /users
 * - CRON : Uniquement le nettoyage des sessions/tokens
 * - Health check : Validation des dépendances critiques (Postgres)
 */

import * as Sentry from '@sentry/node';
import express from 'express';
import cookieParser from 'cookie-parser';
import cron from 'node-cron';

// Config & Utils
import { ENV } from './config/environment.js';
import { pgPool } from './config/database.js';
import { healthCheck } from './utils/healthCheck.js';
import { logInfo, logError } from './utils/logger.js';

// Middlewares
import { requestLogger } from './middlewares/logger.middleware.js';
import { errorHandler } from './middlewares/erroHandler.middleware.js';
import { helmetMiddleware, corsMiddleware, compressResponse } from './config/security.js';

// Router & Jobs
import v1Router from './routes/index.routes.js';
import { sessionsCleanupJob } from './jobs/sessions.cron.js';

const app = express();

// ─────────────────────────────────────────────────────────────────────
// 1. CONFIGURATION RÉSEAU
// Indispensable derrière un reverse proxy (Render, Nginx, API Gateway)
// ─────────────────────────────────────────────────────────────────────
app.set('trust proxy', 1);

// ─────────────────────────────────────────────────────────────────────
// 2. HEALTH CHECK (Priorité Haute)
// Placé avant tous les middlewares pour une réponse immédiate.
// ─────────────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
    try {
        const { postgres } = await healthCheck(pgPool);

        const isHealthy = postgres.status === 'up';

        res.status(isHealthy ? 200 : 503).json({
            status: isHealthy ? 'ok' : 'degraded',
            service: 'auth-service',
            version: process.env.npm_package_version || '1.0.0',
            uptime: process.uptime(),
            dependencies: {
                postgres: postgres.status
            },
        });
    } catch (err) {
        logError(err, { context: 'health-check' });
        res.status(503).json({ status: 'error', service: 'auth-service' });
    }
});

// ─────────────────────────────────────────────────────────────────────
// 3. SÉCURITÉ & LOGS (Avant le parsing)
// Bloquer les requêtes non autorisées AVANT d'allouer de la mémoire
// ─────────────────────────────────────────────────────────────────────
app.use(helmetMiddleware);
app.use(corsMiddleware);
app.use(requestLogger);

// ─────────────────────────────────────────────────────────────────────
// 4. PARSING BODY & COOKIES
// L'auth-service ne reçoit que des identifiants (email, password, tokens).
// Fixer une limite (ex: 10kb) protège contre les attaques DoS.
// ─────────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));
app.use(cookieParser());
app.use(compressResponse);

// ─────────────────────────────────────────────────────────────────────
// 5. ROUTES API
// ─────────────────────────────────────────────────────────────────────
app.use('/api/v1', v1Router);

// ─────────────────────────────────────────────────────────────────────
// 6. GESTION DU 404 (Routes inconnues)
// ─────────────────────────────────────────────────────────────────────
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: `Endpoint introuvable sur le service auth : ${req.originalUrl}`
    });
});

// ─────────────────────────────────────────────────────────────────────
// 7. GESTION DES ERREURS GLOBALES
// ─────────────────────────────────────────────────────────────────────
if (ENV.sentry && ENV.sentry.dsn) {
    Sentry.setupExpressErrorHandler(app);
}

app.use(errorHandler);

// ─────────────────────────────────────────────────────────────────────
// 8. GESTION DES CRONS & GRACEFUL SHUTDOWN
// ─────────────────────────────────────────────────────────────────────

// Initialisation du cron exclusif à l'auth-service
logInfo(`[CRON] Planification du job : ${sessionsCleanupJob.name} (${sessionsCleanupJob.schedule})`);
const sessionCronTask = cron.schedule(
    sessionsCleanupJob.schedule,
    sessionsCleanupJob.execute,
    { scheduled: true }
);

const shutdown = async (signal) => {
    logInfo(`[auth-service] ${signal} reçu — arrêt des processus...`);

    // Arrêt propre du cron
    sessionCronTask.stop();
    logInfo(`[CRON] Job ${sessionsCleanupJob.name} arrêté.`);

    // Fermeture propre du pool de base de données (bonne pratique microservice)
    try {
        await pgPool.end();
        logInfo('[DB] Connexion PostgreSQL fermée avec succès.');
    } catch (err) {
        logError(err, { context: 'shutdown-db-close' });
    }

    process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;