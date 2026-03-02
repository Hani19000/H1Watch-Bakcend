/**
 * @module Utils/Logger
 *
 * Centralise le logging. En production, route vers Sentry.
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

export const logInfo = (message) => {
    if (!isProduction) {
        console.log(`[Info]: ${message}`);
    } else {
        Sentry.addBreadcrumb({ category: 'info', message, level: 'info' });
    }
};
