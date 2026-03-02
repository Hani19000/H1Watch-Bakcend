/**
 * @module Utils/Logger
 *
 * Logging centralisé : Sentry en production, console en dev.
 * Un seul endroit pour changer la stratégie de logging.
 */
import * as Sentry from '@sentry/node';
import { ENV } from '../config/environment.js';

export const logError = (error, context = {}) => {
    Sentry.withScope((scope) => {
        scope.setExtras(context);
        Sentry.captureException(error);
    });
    if (!ENV.server.isProduction) {
        console.error('[admin-service] ERROR', context, error);
    }
};

export const logInfo = (message, context = {}) => {
    if (!ENV.server.isProduction) {
        console.log(`[admin-service] INFO ${message}`, context);
    } else {
        Sentry.addBreadcrumb({ message, data: context, level: 'info' });
    }
};
