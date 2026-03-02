/**
 * @module Middleware/Internal — product-service
 *
 * Protège les routes `/internal/*` en vérifiant le header `X-Internal-Secret`.
 *
 * Ces routes ne transitent jamais par le Gateway Nginx.
 * La comparaison timing-safe prévient les attaques temporelles.
 *
 * Deux périmètres de confiance distincts :
 * - `fromInternalService` → order-service, cart-service, payment-service
 * - `fromAdminService`    → admin-service (stats dashboard uniquement)
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
 * Factorisé pour supporter plusieurs périmètres de confiance
 * sans dupliquer la logique de vérification.
 */
const validateSecret = (expectedSecret) => (req, res, next) => {
    const provided = req.headers[HEADER_NAME];

    if (!provided) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
            status: 'fail',
            message: 'Accès refusé : header interne manquant',
        });
    }

    if (!expectedSecret || !timingSafeEqual(provided, expectedSecret)) {
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

/**
 * Valide les appels entrants depuis les services pairs (order, cart, payment).
 * Utilise `INTERNAL_PRODUCT_SECRET`.
 */
export const fromInternalService = validateSecret(ENV.internalSecret);

/**
 * Valide les appels entrants depuis l'admin-service.
 * Utilise `INTERNAL_ADMIN_SECRET` — secret distinct pour isoler le périmètre admin.
 */
export const fromAdminService = validateSecret(ENV.adminSecret);
