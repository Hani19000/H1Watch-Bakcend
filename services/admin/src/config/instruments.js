/**
 * @module Config/Instruments
 *
 * Initialise Sentry avant tout import applicatif.
 * Ce fichier doit être le premier import de server.js pour capturer
 * les erreurs dès le démarrage du processus Node.
 */
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

Sentry.init({
    dsn: process.env.SENTRY_DSN,
    integrations: [nodeProfilingIntegration()],
    tracesSampleRate: 1.0,
    profilesSampleRate: 1.0,
});
