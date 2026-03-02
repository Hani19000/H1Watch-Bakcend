/**
 * @module App
 *
 * Configuration Express du notification-service.
 *
 * Ce service n'expose que :
 *   - /health → sonde Render/K8s
 *   - /internal/notifications/* → protégé par X-Internal-Secret
 *
 * Pas de rawBody nécessaire (pas de webhook Stripe ici).
 * Pas de PostgreSQL — toutes les persistances passent par Redis (BullMQ).
 */
import * as Sentry from '@sentry/node';
import express from 'express';

import { requestLogger } from './middlewares/logger.middleware.js';
import { errorHandler } from './middlewares/errorHandler.middleware.js';
import {
    helmetMiddleware,
    corsMiddleware,
    compressResponse,
    notFound,
} from './config/security.js';
import { healthCheck } from './utils/healthCheck.js';
import rootRouter from './routes/index.routes.js';

const app = express();

// Requis sur Render derrière un Load Balancer pour lire l'IP réelle du client
app.set('trust proxy', 1);

// ── Health check ──────────────────────────────────────────────────────────────
// Déclaré avant tout middleware pour répondre vite aux sondes Render

app.get('/health', async (_req, res) => {
    const checks = await healthCheck();
    const isHealthy = Object.values(checks).every((s) => s.status === 'up');
    res.status(isHealthy ? 200 : 503).json({
        status: isHealthy ? 'up' : 'degraded',
        checks,
    });
});

// ── Sécurité ──────────────────────────────────────────────────────────────────

app.use(helmetMiddleware);
app.use(corsMiddleware);
app.use(compressResponse);

// ── Body parsing ──────────────────────────────────────────────────────────────

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true }));

// ── Logging ───────────────────────────────────────────────────────────────────

app.use(requestLogger);

// ── Routes ────────────────────────────────────────────────────────────────────

app.use(rootRouter);

// ── Gestion des erreurs ───────────────────────────────────────────────────────

Sentry.setupExpressErrorHandler(app);
app.use(notFound);
app.use(errorHandler);

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

export default app;
