/**
 * @module Config/Instruments
 *
 * Initialisation de Sentry — doit être importé EN PREMIER dans le point d'entrée
 * de l'application (avant Express, avant les routes) pour que le SDK puisse
 * instrumenter toutes les dépendances et capturer les erreurs non gérées.
 *
 * Sentry intercepte automatiquement :
 *  - Les exceptions non attrapées (uncaughtException)
 *  - Les rejets de promesses non gérés (unhandledRejection)
 *  - Les erreurs propagées via le middleware d'erreur Express
 *
 * IMPORTANT — @sentry/profiling-node :
 * Ce package charge un binding natif (.node) compilé pour une architecture
 * et une version d'ABI Node précises. Sur node:22-alpine, si le prebuilt
 * binary est absent ou incompatible (cache Docker invalidé, --legacy-peer-deps,
 * changement de platform), l'import throw avant que startServer() soit appelé.
 * Comme le handler uncaughtException est enregistré DANS startServer(),
 * le crash est silencieux côté logs et Render détecte un timeout ("no open ports").
 *
 * Le bloc try/catch garantit que Sentry démarre sans le profiling plutôt
 * que de faire crasher tout le service au démarrage.
 */
import * as Sentry from '@sentry/node';
import 'dotenv/config';

let integrations = [];

try {
    const { nodeProfilingIntegration } = await import('@sentry/profiling-node');
    integrations = [nodeProfilingIntegration()];
} catch {
    // Binding natif indisponible sur cette plateforme/ABI — Sentry démarre sans profiling.
    // Le service reste pleinement fonctionnel ; seul le CPU profiling Sentry est désactivé.
    console.warn('[Sentry] @sentry/profiling-node indisponible — profiling désactivé.');
}

Sentry.init({
    dsn: process.env.SENTRY_DSN,
    integrations,
    tracesSampleRate: 1.0,
    profilesSampleRate: 1.0,
});