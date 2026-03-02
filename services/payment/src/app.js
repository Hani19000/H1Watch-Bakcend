/**
 * @module App
 *
 * Configuration Express du payment-service.
 *
 * Particularité critique : le webhook Stripe DOIT recevoir le corps brut (rawBody)
 * pour que la vérification de signature HMAC soit possible.
 * express.json() est donc configuré avec un callback `verify` qui capture le
 * Buffer original avant parsing — il ne faut PAS monter express.raw() séparément.
 *
 * Ordre des middlewares :
 *   1. Health check (avant tout, pour répondre vite aux sondes)
 *   2. Sécurité (helmet, cors, compression)
 *   3. Body parsing + capture rawBody
 *   4. Sanitisation des entrées
 *   5. Logging des requêtes
 *   6. Routes applicatives
 *   7. Gestion centralisée des erreurs (en dernier)
 */
import * as Sentry from '@sentry/node';
import express from 'express';
import cookieParser from 'cookie-parser';

import { requestLogger } from './middlewares/logger.middleware.js';
import { sanitizer } from './middlewares/sanitizer.middleware.js';
import { errorHandler } from './middlewares/erroHandler.middleware.js';
import {
    helmetMiddleware,
    corsMiddleware,
    compressResponse,
    notFound,
} from './config/security.js';
import { pgPool } from './config/database.js';
import { healthCheck } from './utils/healthCheck.js';
import rootRouter from './routes/index.routes.js';

const app = express();

// Indispensable sur Render et toute plateforme PaaS derrière un Load Balancer.
// Sans ce flag, express-rate-limit lit l'IP du proxy et non celle du client réel.
app.set('trust proxy', 1);

// ─────────────────────────────────────────────────────────────────────────────
// HEALTH CHECK
// Déclaré avant les middlewares pour répondre le plus vite possible
// aux sondes Render/K8s sans passer par le pipeline complet.
// ─────────────────────────────────────────────────────────────────────────────

app.get('/health', async (_req, res) => {
    const status = await healthCheck(pgPool);
    const isHealthy = Object.values(status).every((s) => s.status === 'up');
    res.status(isHealthy ? 200 : 503).json({
        status: isHealthy ? 'up' : 'degraded',
        checks: status,
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// BODY PARSING
//
// Le callback `verify` est la seule façon supportée par Express pour accéder
// au corps brut sans désactiver le parsing JSON global.
// Stripe exige ce Buffer original pour reconstruire et vérifier la signature HMAC.
// Sans lui, stripe.webhooks.constructEvent() lève une SignatureVerificationError.
// ─────────────────────────────────────────────────────────────────────────────

app.use(
    express.json({
        verify: (req, _res, buf) => {
            req.rawBody = buf;
        },
    })
);
app.use(express.urlencoded({ extended: true }));

// ─────────────────────────────────────────────────────────────────────────────
// PIPELINE SÉCURITÉ
// ─────────────────────────────────────────────────────────────────────────────

app.use(helmetMiddleware);
app.use(corsMiddleware);
app.use(cookieParser());
app.use(compressResponse);

// Sanitisation des inputs avant qu'ils n'atteignent les contrôleurs.
// Positionné après le parsing pour opérer sur req.body/query/params.
app.use(sanitizer);

// ─────────────────────────────────────────────────────────────────────────────
// LOGGING
// ─────────────────────────────────────────────────────────────────────────────

app.use(requestLogger);

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────────

app.use(rootRouter);

// ─────────────────────────────────────────────────────────────────────────────
// GESTION DES ERREURS
// Sentry doit capturer avant le handler applicatif pour inclure la stack trace.
// Le 404 est traité ici pour rester dans le même pipeline d'erreur centralisé.
// ─────────────────────────────────────────────────────────────────────────────

Sentry.setupExpressErrorHandler(app);
app.use(notFound);
app.use(errorHandler);

// Arrêts propres pour libérer les connexions DB/Redis avant extinction
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

export default app;
