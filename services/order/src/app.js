/**
 * @module App
 *
 * Configuration Express de l'order-service.
 * Monte uniquement les routes order et les endpoints internes inter-services.
 * Le reste (auth, products, cart, payment...) reste dans le monolith.
 */
import * as Sentry from '@sentry/node';
import express from 'express';
import cookieParser from 'cookie-parser';

import { requestLogger } from './middlewares/logger.middleware.js';
import { errorHandler } from './middlewares/erroHandler.middleware.js';
import {
    helmetMiddleware,
    corsMiddleware,
    compressResponse,
    notFound,
} from './config/security.js';
import { pgPool } from './config/database.js';
import { healthCheck } from './utils/healthCheck.js';
import { logInfo } from './utils/logger.js';
import { ordersCleanupJob } from './jobs/orders.cron.js';
import rootRouter from './routes/index.routes.js';

const app = express();

// Nécessaire sur Render et toute plateforme PaaS derrière un Load Balancer
// pour que express-rate-limit lise la vraie IP depuis X-Forwarded-For.
app.set('trust proxy', 1);

// ─────────────────────────────────────────────────────────────────────
// HEALTH CHECK
// Déclaré avant les middlewares pour éviter les logs inutiles
// et répondre le plus vite possible aux sondes Render/K8s.
// ─────────────────────────────────────────────────────────────────────

app.get('/health', async (_req, res) => {
    const status = await healthCheck(pgPool);
    const isHealthy = Object.values(status).every((s) => s.status === 'up');
    res.status(isHealthy ? 200 : 503).json({ status: isHealthy ? 'up' : 'degraded', checks: status });
});

// ─────────────────────────────────────────────────────────────────────
// BODY PARSING
// ─────────────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─────────────────────────────────────────────────────────────────────
// PIPELINE SÉCURITÉ ET LOGS
// ─────────────────────────────────────────────────────────────────────

app.use(helmetMiddleware);
app.use(corsMiddleware);
app.use(cookieParser());
app.use(compressResponse);
app.use(requestLogger);

// ─────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────

app.use(rootRouter);

// ─────────────────────────────────────────────────────────────────────
// GESTION DES ERREURS
// Sentry doit être enregistré avant le handler d'erreur applicatif.
// ─────────────────────────────────────────────────────────────────────

Sentry.setupExpressErrorHandler(app);
app.use(notFound);
app.use(errorHandler);

// ─────────────────────────────────────────────────────────────────────
// CRON JOB — Nettoyage des commandes abandonnées
// ─────────────────────────────────────────────────────────────────────

const cron = await import('node-cron');
cron.default.schedule(ordersCleanupJob.schedule, () => {
    logInfo(`[CRON] Démarrage : ${ordersCleanupJob.name}`);
    ordersCleanupJob.execute();
});

// Arrêt propre avant extinction du processus
process.on('SIGTERM', () => {
    logInfo('SIGTERM reçu — arrêt propre de l\'order-service');
    process.exit(0);
});

process.on('SIGINT', () => {
    logInfo('SIGINT reçu — arrêt propre de l\'order-service');
    process.exit(0);
});

export default app;