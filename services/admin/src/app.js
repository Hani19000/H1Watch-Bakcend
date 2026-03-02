/**
 * @module App
 *
 * Configuration Express du admin-service.
 * Le health check est déclaré avant les middlewares lourds pour garantir
 * une réponse rapide lors du démarrage Render.
 */
import * as Sentry from '@sentry/node';
import express from 'express';
import cookieParser from 'cookie-parser';
import { helmetMiddleware, corsMiddleware, compressResponse } from './config/security.js';
import { errorHandler } from './middlewares/errorHandler.middleware.js';
import router from './routes/index.routes.js';

const app = express();

// Render valide le déploiement via ce endpoint — doit répondre même si Redis est lent.
app.get('/health', (_req, res) => {
    res.status(200).json({
        service: 'admin-service',
        status: 'ok',
        timestamp: new Date().toISOString(),
    });
});

app.use(helmetMiddleware);
app.use(corsMiddleware);
app.use(compressResponse);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.use(router);

app.use((_req, res) => res.status(404).json({ status: 'fail', message: 'Route introuvable' }));

Sentry.setupExpressErrorHandler(app);
app.use(errorHandler);

export default app;
