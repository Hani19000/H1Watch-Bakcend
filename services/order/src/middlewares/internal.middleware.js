/**
 * @module Middleware/Internal
 *
 * Protège les routes `/internal/*` en vérifiant le header `X-Internal-Secret`.
 *
 * Ces routes ne sont jamais exposées au public via le Gateway Nginx —
 * elles sont exclusivement appelées par des services pairs.
 * La vérification timing-safe prévient les attaques par analyse temporelle
 * qui permettraient de deviner le secret caractère par caractère.
 *
 * Trois périmètres de confiance distincts :
 * - `fromMonolith`      → monolith (payment webhook Stripe)
 * - `fromAuthService`   → auth-service (autoClaimGuestOrders, historique, stats)
 * - `fromAdminService`  → admin-service (stats dashboard, déclencheurs crons)
 */
import crypto from 'crypto';
import { ENV } from '../config/environment.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { logError } from '../utils/logger.js';

const HEADER_NAME = 'x-internal-secret';

/**
 * Comparaison timing-safe de deux secrets.
 * Un padding factice est exécuté même si les longueurs diffèrent,
 * afin de garantir un temps de réponse constant quelle que soit la valeur fournie.
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
 * Middleware générique — valide le header X-Internal-Secret contre un secret attendu.
 * Factorisé pour éviter la duplication de logique entre les trois périmètres.
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
            context: 'order-service.internal.middleware',
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

/**
 * Valide les appels entrants depuis l'admin-service.
 * Utilise `INTERNAL_ADMIN_SECRET`.
 */
export const fromAdminService = validateSecret(ENV.internal.adminSecret);
