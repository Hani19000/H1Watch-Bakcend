/**
 * @module Middlewares/Internal
 *
 * Protège les routes /internal du cart-service.
 * Seuls les services disposant du secret partagé peuvent appeler ces routes.
 *
 * timingSafeEqual prévient les attaques par timing (comparaison caractère par caractère).
 */
import { timingSafeEqual } from 'crypto';
import { AppError } from '../utils/appError.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';

const CART_SECRET = process.env.INTERNAL_CART_SECRET || '';

export const fromInternalService = (req, _res, next) => {
    const provided = req.headers['x-internal-secret'] || '';

    try {
        const expected = Buffer.from(CART_SECRET);
        const received = Buffer.from(provided.padEnd(CART_SECRET.length, '\0'));

        const isValid =
            expected.length === received.length &&
            timingSafeEqual(expected, received);

        if (!isValid) {
            return next(new AppError('Accès interdit', HTTP_STATUS.FORBIDDEN));
        }
    } catch {
        return next(new AppError('Accès interdit', HTTP_STATUS.FORBIDDEN));
    }

    next();
};
