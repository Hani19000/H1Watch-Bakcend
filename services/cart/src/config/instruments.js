/**
 * @module Config/Instruments
 *
 * Initialisation de Sentry — doit être importé EN PREMIER dans server.js
 * avant Express et les routes pour instrumenter toutes les dépendances
 * et capturer les erreurs non gérées automatiquement.
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
