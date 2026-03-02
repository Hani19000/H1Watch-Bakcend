/**
 * @module Middleware/Internal
 *
 * Protège les routes `/internal/*` du monolith.
 * Valide le header `X-Internal-Secret` envoyé par l'order-service.
 *
 * La comparaison timing-safe prévient les attaques par analyse temporelle
 * qui permettraient de deviner le secret caractère par caractère.
 */
import crypto from 'crypto';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { logError } from '../utils/logger.js';

const HEADER_NAME = 'x-internal-secret';

const timingSafeEqual = (provided, expected) => {
    try {
        const providedBuf = Buffer.from(provided, 'utf8');
        const expectedBuf = Buffer.from(expected, 'utf8');

        if (providedBuf.length !== expectedBuf.length) {
            crypto.timingSafeEqual(expectedBuf, expectedBuf);
            return false;
        }

        return crypto.timingSafeEqual(providedBuf, expectedBuf);
    } catch {
        return false;
    }
};

/**
 * Valide les appels entrants depuis l'order-service.
 * Utilise `INTERNAL_ORDER_SECRET`.
 */
export const fromOrderService = (req, res, next) => {
    const provided = req.headers[HEADER_NAME];

    if (!provided) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
            status: 'fail',
            message: 'Accès refusé : header interne manquant',
        });
    }

    const expected = process.env.INTERNAL_ORDER_SECRET;

    if (!expected || !timingSafeEqual(provided, expected)) {
        logError(new Error('Tentative accès interne avec secret invalide'), {
            context: 'monolith.internal.middleware',
            ip: req.ip,
            path: req.originalUrl,
        });

        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
            status: 'fail',
            message: 'Accès refusé : secret invalide',
        });
    }

    next();
};