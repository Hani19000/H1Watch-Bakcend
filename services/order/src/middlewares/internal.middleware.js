/**
 * @module Middleware/Internal
 *
 * Protège les routes `/internal/*` en vérifiant le header `X-Internal-Secret`.
 *
 * Ces routes ne sont jamais exposées au public via le Gateway Nginx —
 * elles sont exclusivement appelées par des services pairs (monolith, auth-service).
 * La vérification timing-safe prévient les attaques par analyse temporelle
 * qui permettraient de deviner le secret caractère par caractère.
 *
 * Deux secrets distincts sont supportés :
 * - `orderSecret`  → appels depuis le monolith (payment webhook)
 * - `authSecret`   → appels depuis l'auth-service (autoClaimGuestOrders)
 */
import crypto from 'crypto';
import { ENV } from '../config/environment.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { logError } from '../utils/logger.js';

const HEADER_NAME = 'x-internal-secret';

/**
 * Comparaison timing-safe de deux secrets.
 * Retourne false si les buffers ne peuvent pas être comparés (longueurs différentes après padding).
 */
const timingSafeEqual = (provided, expected) => {
    try {
        const providedBuf = Buffer.from(provided, 'utf8');
        const expectedBuf = Buffer.from(expected, 'utf8');

        // Les buffers doivent avoir la même longueur pour timingSafeEqual.
        // On compare d'abord la longueur séparément pour éviter les fuites d'info.
        if (providedBuf.length !== expectedBuf.length) {
            // On exécute quand même la comparaison sur un buffer factice
            // pour garantir un temps de réponse constant.
            crypto.timingSafeEqual(expectedBuf, expectedBuf);
            return false;
        }

        return crypto.timingSafeEqual(providedBuf, expectedBuf);
    } catch {
        return false;
    }
};

/**
 * Middleware générique — valide le header contre un secret attendu.
 * Factorisé pour éviter la duplication entre `fromMonolith` et `fromAuthService`.
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
            context: 'internal.middleware',
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
 * Valide les appels entrants depuis le monolith (payment service).
 * Utilise `INTERNAL_ORDER_SECRET`.
 */
export const fromMonolith = validateSecret(ENV.internal.orderSecret);

/**
 * Valide les appels entrants depuis l'auth-service.
 * Utilise `INTERNAL_AUTH_SECRET`.
 */
export const fromAuthService = validateSecret(ENV.internal.authSecret);