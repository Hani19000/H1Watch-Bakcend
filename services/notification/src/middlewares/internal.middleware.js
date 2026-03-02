/**
 * @module Middleware/Internal
 *
 * Protège les routes `/internal/*` en vérifiant le header `X-Internal-Secret`.
 *
 * Ces routes ne sont jamais exposées via Nginx — elles sont exclusivement
 * appelées par des services pairs (auth, order, payment, cart).
 * La comparaison timing-safe prévient les attaques par analyse temporelle
 * qui permettraient de reconstituer le secret caractère par caractère.
 */
import crypto from 'crypto';
import { ENV } from '../config/environment.js';
import { logError } from '../utils/logger.js';

const HEADER_NAME = 'x-internal-secret';

/**
 * Comparaison timing-safe.
 * Garantit un temps de réponse constant quelle que soit la valeur fournie.
 */
const timingSafeEqual = (provided, expected) => {
    try {
        const providedBuf = Buffer.from(provided, 'utf8');
        const expectedBuf = Buffer.from(expected, 'utf8');

        // Longueurs différentes → accès refusé, mais on exécute quand même
        // la comparaison sur un buffer factice pour masquer l'information
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
 * Middleware de protection des routes internes.
 * Valide le header X-Internal-Secret contre INTERNAL_NOTIFICATION_SECRET.
 */
export const fromInternalService = (req, res, next) => {
    const provided = req.headers[HEADER_NAME];

    if (!provided) {
        return res.status(401).json({
            status: 'fail',
            message: 'Accès refusé : header interne manquant',
        });
    }

    if (!timingSafeEqual(provided, ENV.internal.notificationSecret)) {
        logError(new Error('Tentative accès interne avec secret invalide'), {
            context: 'internal.middleware',
            ip: req.ip,
            path: req.originalUrl,
        });

        return res.status(401).json({
            status: 'fail',
            message: 'Accès refusé : secret invalide',
        });
    }

    next();
};
