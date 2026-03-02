/**
 * @module Middleware/Internal — auth-service
 *
 * Protège les routes `/internal/*` en vérifiant le header `X-Internal-Secret`.
 *
 * Ces routes ne transitent jamais par le Gateway Nginx — elles sont exclusivement
 * appelées par des services pairs sur le réseau interne Render.
 * La comparaison timing-safe prévient les attaques temporelles qui permettraient
 * de deviner le secret caractère par caractère.
 */
import crypto from 'crypto';
import { ENV } from '../config/environment.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { logError } from '../utils/logger.js';

const HEADER_NAME = 'x-internal-secret';

/**
 * Comparaison en temps constant pour éviter les attaques temporelles.
 * Un padding factice est exécuté même si les longueurs diffèrent
 * afin de garantir un temps de traitement constant.
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
 * Génère un middleware de validation du secret interne.
 * Factorisé pour permettre plusieurs périmètres de confiance distincts.
 */
const validateSecret = (expectedSecret) => (req, res, next) => {
    const provided = req.headers[HEADER_NAME];

    if (!provided) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
            status: 'fail',
            message: 'Accès refusé : header interne manquant',
        });
    }

    if (!timingSafeEqual(provided, expectedSecret)) {
        // Ne pas révéler si le header existe mais est incorrect.
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

/**
 * Valide les appels entrants depuis l'admin-service.
 * Utilise `INTERNAL_ADMIN_SECRET` — secret partagé uniquement avec l'admin-service.
 */
export const fromAdminService = validateSecret(ENV.internal.adminSecret);
