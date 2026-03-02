/**
 * @module Middlewares/Internal
 *
 * Protège les routes /internal du admin-service.
 * timingSafeEqual prévient les attaques par timing sur la comparaison du secret.
 */
import { timingSafeEqual } from 'crypto';
import { ENV } from '../config/environment.js';
import { AppError } from '../utils/appError.js';

export const fromInternalService = (req, _res, next) => {
    const provided = req.headers['x-internal-secret'] || '';
    const expected = ENV.internal.adminSecret;

    try {
        const isValid =
            provided.length === expected.length &&
            timingSafeEqual(Buffer.from(provided), Buffer.from(expected));

        if (!isValid) return next(new AppError('Accès interdit', 403));
    } catch {
        return next(new AppError('Accès interdit', 403));
    }

    next();
};
