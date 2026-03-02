/**
 * @module Utils/Logger
 *
 * Centralise le logging de l'application.
 * S'appuie sur Sentry (initialisé dans instruments.js) pour la production.
 */
import * as Sentry from '@sentry/node';
import { ENV } from '../config/environment.js';

const isProduction = ENV.server.nodeEnv === 'production';

export const logError = (error, context = {}) => {
    Sentry.setExtras(context);
    Sentry.captureException(error);

    // Uniquement en développement — évite de polluer les logs de production
    if (!isProduction) {
        console.error(`[Error]: ${error.message}`);
        if (Object.keys(context).length > 0) {
            console.error('Context:', JSON.stringify(context, null, 2));
        }
    }
};

/**
 * Pour les événements significatifs (démarrage de services, actions critiques).
 * En production, envoie un breadcrumb Sentry plutôt que de loguer en console.
 */
export const logInfo = (message) => {
    if (!isProduction) {
        console.log(`[Info]: ${message}`);
    } else {
        Sentry.addBreadcrumb({
            category: 'info',
            message,
            level: 'info',
        });
    }
};