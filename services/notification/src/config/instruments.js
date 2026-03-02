/**
 * @module Config/Instruments
 *
 * Initialisation de Sentry — doit être importé EN PREMIER dans server.js
 * pour instrumenter toutes les dépendances dès le démarrage.
 * Capture également les erreurs des workers BullMQ via le hook global.
 */
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import 'dotenv/config';

Sentry.init({
    dsn: process.env.SENTRY_DSN,
    integrations: [nodeProfilingIntegration()],
    tracesSampleRate: 1.0,
    profilesSampleRate: 1.0,
});
