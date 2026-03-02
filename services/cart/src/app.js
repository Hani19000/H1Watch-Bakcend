/**
 * @module App
 *
 * Configuration Express du cart-service.
 * Le health check est déclaré AVANT les middlewares lourds pour garantir
 * qu'il répond même si la DB est lente (Render valide le déploiement avec ce check).
 */
import * as Sentry from '@sentry/node';
import express from 'express';
import cookieParser from 'cookie-parser';
import { helmetMiddleware, corsMiddleware, compressResponse, notFound } from './config/security.js';
import { requestLogger } from './middlewares/requestLogger.middleware.js';
import { errorHandler } from './middlewares/errorHandler.middleware.js';
import { healthCheck } from './utils/healthCheck.js';
import { pgPool } from './config/database.js';
import router from './routes/index.routes.js';

const app = express();

// ── Health check (avant tous les middlewares) ──────────────────────────────────
// Réponse garantie même si Neon ou Redis mettent du temps à se connecter.
app.get('/health', async (_req, res) => {
    const status = await healthCheck(pgPool);
    const isHealthy = status.postgres.status === 'up';

    res.status(isHealthy ? 200 : 503).json({
        service: 'cart-service',
        status: isHealthy ? 'ok' : 'degraded',
        timestamp: new Date().toISOString(),
        dependencies: status,
    });
});

// ── Sécurité ──────────────────────────────────────────────────────────────────
app.use(helmetMiddleware);
app.use(corsMiddleware);
app.use(compressResponse);

// ── Parsing ───────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// ── Logging (développement uniquement) ────────────────────────────────────────
app.use(requestLogger);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use(router);

// ── Erreurs ───────────────────────────────────────────────────────────────────
app.use(notFound);
Sentry.setupExpressErrorHandler(app);
app.use(errorHandler);

export default app;
