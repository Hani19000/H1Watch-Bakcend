/**
 * @module Middlewares/Internal — auth-service
 *
 * Protège les routes /internal/* en vérifiant le header X-Internal-Secret.
 *
 * Ces routes ne sont jamais exposées via le Gateway Nginx —
 * elles sont exclusivement appelées par l'admin-service.
 *
 * La comparaison timing-safe prévient les attaques par analyse temporelle
 * qui permettraient de deviner le secret caractère par caractère.
 */
import crypto from 'crypto';
import { ENV } from '../config/environment.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { logError } from '../utils/logger.js';

const HEADER_NAME = 'x-internal-secret';

/**
 * Comparaison en temps constant pour éviter les attaques temporelles.
 * Un padding factice est exécuté même si les longueurs diffèrent,
 * afin de ne pas révéler si le secret est trop court ou trop long.
 */
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
 * Valide les appels entrants depuis l'admin-service.
 * Utilise INTERNAL_AUTH_SECRET — l'admin-service doit envoyer cette valeur
 * dans le header X-Internal-Secret.
 */
export const fromAdminService = (req, res, next) => {
    const provided = req.headers[HEADER_NAME];

    if (!provided) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
            status: 'fail',
            message: 'Accès refusé : header interne manquant',
        });
    }

    const expected = ENV.services.internalSecret;

    if (!expected || !timingSafeEqual(provided, expected)) {
        logError(new Error('Tentative accès interne avec secret invalide'), {
            context: 'auth-service.internal.middleware',
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
