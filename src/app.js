import * as Sentry from '@sentry/node';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';

import { requestLogger } from './middlewares/logger.middleware.js';
import { errorHandler } from './middlewares/erroHandler.middleware.js';
import v1Router from './routes/index.routes.js';
import internalRoutes from './routes/internal.routes.js';
import {
    helmetMiddleware,
    corsMiddleware,
    compressResponse,
} from './config/security.js';
import { healthService } from './services/health.service.js';
import { logInfo } from './utils/logger.js';
import { initializeCronJobs, shutdownCronJobs } from './jobs/index.js';

const app = express();
app.set('trust proxy', 1);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─────────────────────────────────────────────────────────────────────
// HEALTH CHECK
// ─────────────────────────────────────────────────────────────────────

app.get('/health', async (_req, res) => {
    const { isHealthy, status } = await healthService.check();
    res.status(isHealthy ? 200 : 503).json(status);
});

// ─────────────────────────────────────────────────────────────────────
// BODY PARSING
// rawBody est conservé sur les requêtes webhook pour permettre la
// vérification de signature HMAC Stripe côté contrôleur.
// ─────────────────────────────────────────────────────────────────────

app.use(express.json({
    verify: (req, _res, buf) => {
        if (req.originalUrl?.includes('/webhook')) {
            req.rawBody = buf;
        }
    },
}));

// ─────────────────────────────────────────────────────────────────────
// PIPELINE SÉCURITÉ ET LOGS
// ─────────────────────────────────────────────────────────────────────

app.use(helmetMiddleware);
app.use(corsMiddleware);
app.use(cookieParser());
app.use(compressResponse);
app.use(requestLogger);

// ─────────────────────────────────────────────────────────────────────
// FICHIERS STATIQUES
// ─────────────────────────────────────────────────────────────────────

app.use('/images', express.static(path.join(__dirname, 'public/images'), {
    setHeaders: (res) => {
        res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    },
}));

// ─────────────────────────────────────────────────────────────────────
// ROUTES INTER-SERVICES — /internal/*
//
// Montées à la RACINE de l'app (pas sous /api/v1) pour que l'order-service
// puisse appeler ${MONOLITH_URL}/internal/inventory/reserve directement.
//
// Ces routes ne passent JAMAIS par le Gateway (bloquées par nginx :
//   location ~ ^/internal/ { return 404; }
// Elles ne sont accessibles qu'en réseau interne Render (service-to-service).
// ─────────────────────────────────────────────────────────────────────

app.use('/internal', internalRoutes);

// ─────────────────────────────────────────────────────────────────────
// ROUTES API PUBLIQUES ET AUTHENTIFIÉES
// Le rate limiter général est appliqué dans index.routes.js —
// l'appliquer ici en plus provoquerait un double comptage sur /api/v1.
// ─────────────────────────────────────────────────────────────────────

app.use('/api/v1', v1Router);

// ─────────────────────────────────────────────────────────────────────
// GESTION DES ERREURS
// Sentry doit être enregistré avant le handler d'erreur applicatif.
// ─────────────────────────────────────────────────────────────────────

Sentry.setupExpressErrorHandler(app);
app.use(errorHandler);

// ─────────────────────────────────────────────────────────────────────
// CRON JOBS
// ─────────────────────────────────────────────────────────────────────

initializeCronJobs();

// Arrêt propre des crons avant extinction du processus
process.on('SIGTERM', () => {
    logInfo('SIGTERM reçu, arrêt des crons...');
    shutdownCronJobs();
    process.exit(0);
});

process.on('SIGINT', () => {
    logInfo('SIGINT reçu, arrêt des crons...');
    shutdownCronJobs();
    process.exit(0);
});

export default app;