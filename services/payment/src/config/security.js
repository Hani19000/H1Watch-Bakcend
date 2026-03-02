/**
 * @module Config/Security
 *
 * Middlewares de sécurité et rate limiters du payment-service.
 *
 * Rate limiters spécifiques aux flux de paiement :
 * - checkoutLimiter : empêche la création de sessions en masse (fraude, DDoS)
 * - statusLimiter   : prévient le polling abusif sur le statut de paiement
 * - generalLimiter  : rempart global sur toutes les autres routes
 *
 * Les webhooks Stripe ne sont PAS soumis au rate limiter — Stripe peut
 * renvoyer des events légitimement plusieurs fois et ne doit pas être bloqué.
 */
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { ENV } from './environment.js';
import { logInfo } from '../utils/logger.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { NotFoundError } from '../utils/appError.js';

// ================================================================
// UTILITAIRES INTERNES
// ================================================================

/**
 * Génère une clé de rate limiting à partir de l'IP réelle du client.
 *
 * Pourquoi ipKeyGenerator plutôt qu'un accès direct à req.ip :
 *   express-rate-limit v7+ exige l'usage de ce helper pour normaliser les
 *   adresses IPv6 (ex: ::ffff:1.2.3.4 → 1.2.3.4). Sans lui, un client IPv6
 *   pourrait contourner les limites avec plusieurs représentations de la même IP.
 *
 * Prérequis : `app.set('trust proxy', 1)` doit être activé dans app.js.
 *   Avec ce flag, Express extrait automatiquement l'IP réelle depuis
 *   X-Forwarded-For (positionné par Render/Nginx), ce qui rend inutile
 *   toute extraction manuelle du header ici.
 */
const getClientIp = (req) => ipKeyGenerator(req);

const getAllowedOrigins = () => {
    if (ENV.server.nodeEnv === 'production') {
        return ['https://ecomwatch.vercel.app', /\.vercel\.app$/];
    }
    return [];
};

const getOrigins = () => {
    const envOrigins = ENV.cors.origins;
    const defaultOrigins = getAllowedOrigins();
    const combined = [...envOrigins, ...defaultOrigins];

    const uniqueStrings = [...new Set(combined.filter((o) => typeof o === 'string'))];
    const regexes = combined.filter((o) => o instanceof RegExp);

    return [...uniqueStrings, ...regexes];
};

const origins = getOrigins();

// ================================================================
// MIDDLEWARES GLOBAUX
// ================================================================

export const helmetMiddleware = helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:'],
            connectSrc: [
                "'self'",
                'https://ecomwatch.vercel.app',
                'https://o4510681965199360.ingest.de.sentry.io',
            ],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameSrc: ["'none'"],
            upgradeInsecureRequests: [],
        },
    },
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
    },
});

export const corsMiddleware = cors({
    origin: (origin, callback) => {
        const isAllowed =
            !origin ||
            origins.some((allowedOrigin) =>
                allowedOrigin instanceof RegExp
                    ? allowedOrigin.test(origin)
                    : allowedOrigin === origin
            );

        return isAllowed
            ? callback(null, true)
            : callback(new Error(`Origine non autorisée par CORS : ${origin}`));
    },
    methods: ['GET', 'POST'],
    credentials: true,
});

export const compressResponse = compression({
    filter: (req, res) => {
        if (req.headers['x-no-compression']) return false;
        return compression.filter(req, res);
    },
    level: 6,
});

// ================================================================
// RATE LIMITERS
// ================================================================

/**
 * Limiteur Global — rempart contre le scraping et les DDoS basiques.
 */
export const generalLimiter = rateLimit({
    windowMs: ENV.rateLimit.windowMs,
    max: ENV.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: getClientIp,
});

/**
 * Limiteur Checkout — empêche la création de sessions Stripe en masse.
 * Une session Stripe a un coût côté Stripe ; limiter sa création réduit
 * le risque de fraude et les coûts API.
 */
export const checkoutLimiter = rateLimit({
    windowMs: ENV.rateLimit.checkoutWindowMs,
    max: ENV.rateLimit.checkoutMax,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `checkout:${getClientIp(req)}`,
    handler: (req, res) => {
        logInfo(`Rate limit checkout dépassé : IP=${getClientIp(req)}`);
        res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
            status: HTTP_STATUS.TOO_MANY_REQUESTS,
            message: 'Trop de tentatives de paiement. Veuillez réessayer dans une minute.',
            retryAfter: '1 minute',
        });
    },
});

/**
 * Limiteur Status — prévient le polling abusif sur le statut de paiement.
 * Un client légitime poll 3-5 fois maximum après redirection Stripe.
 */
export const statusLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `payment-status:${getClientIp(req)}`,
    handler: (req, res) => {
        logInfo(`Rate limit status payment dépassé : IP=${getClientIp(req)}`);
        res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
            status: HTTP_STATUS.TOO_MANY_REQUESTS,
            message: 'Trop de vérifications de statut. Veuillez patienter.',
            retryAfter: '1 minute',
        });
    },
});

// ================================================================
// GESTION DES ERREURS
// ================================================================

export const notFound = (req, _res, next) => {
    next(new NotFoundError('Route', req.originalUrl));
};
