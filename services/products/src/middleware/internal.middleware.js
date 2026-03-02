/**
 * @module Middleware/Internal
 *
 * Protège les routes `/internal/*` du product-service.
 * Valide le header `X-Internal-Secret` envoyé par les services consommateurs
 * (order-service, cart-service, admin-service).
 *
 * UN seul secret (`INTERNAL_PRODUCT_SECRET`) partagé avec tous les appelants.
 * La comparaison timing-safe prévient les attaques par analyse temporelle.
 */
import crypto from 'crypto';
import { ENV } from '../config/environment.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { logError } from '../utils/logger.js';

const HEADER_NAME = 'x-internal-secret';

/**
 * Comparaison en temps constant pour éviter les attaques temporelles.
 * Même longueur de traitement même si les secrets diffèrent à la première position.
 */
const timingSafeEqual = (provided, expected) => {
    try {
        const providedBuf = Buffer.from(provided, 'utf8');
        const expectedBuf = Buffer.from(expected, 'utf8');

        // Si les longueurs diffèrent, on effectue quand même la comparaison
        // pour ne pas fuiter d'information via le timing
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
 * Valide les appels entrants depuis n'importe quel service interne.
 * Utilise ENV.internalSecret (INTERNAL_PRODUCT_SECRET) — centralisé dans
 * environment.js pour rester cohérent avec tous les autres services.
 */
export const fromInternalService = (req, res, next) => {
    const provided = req.headers[HEADER_NAME];

    if (!provided) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
            status: 'fail',
            message: 'Accès refusé : header interne manquant',
        });
    }

    const expected = ENV.internalSecret;

    if (!expected || !timingSafeEqual(provided, expected)) {
        logError(new Error('Tentative accès interne avec secret invalide'), {
            context: 'product-service.internal.middleware',
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
