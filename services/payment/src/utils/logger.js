/**
 * @module Utils/Logger
 *
 * Centralise le logging de l'application.
 * En production, route les erreurs vers Sentry plutôt que la console.
 */
import * as Sentry from '@sentry/node';
import { ENV } from '../config/environment.js';

const isProduction = ENV.server.nodeEnv === 'production';

export const logError = (error, context = {}) => {
    Sentry.setExtras(context);
    Sentry.captureException(error);

    if (!isProduction) {
        console.error(`[Error]: ${error.message}`);
        if (Object.keys(context).length > 0) {
            console.error('Context:', JSON.stringify(context, null, 2));
        }
    }
};

/**
 * Pour les événements significatifs (démarrage, actions critiques).
 * En production, envoi un breadcrumb Sentry pour la traçabilité.
 */
export const logInfo = (message) => {
    if (!isProduction) {
        console.log(`[Info]: ${message}`);
    } else {
        Sentry.addBreadcrumb({ category: 'info', message, level: 'info' });
    }
};