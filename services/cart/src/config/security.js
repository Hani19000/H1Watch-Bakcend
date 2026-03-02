/**
 * @module Config/Security
 *
 * Middlewares de sécurité et rate limiters du cart-service.
 *
 * Le cart est une route authentifiée — CORS strict et rate limiter
 * adapté aux interactions UI (ajout/suppression fréquents).
 */
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { ENV } from './environment.js';
import { logInfo } from '../utils/logger.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { NotFoundError } from '../utils/appError.js';

// ================================================================
// UTILITAIRES
// ================================================================

/**
 * Extrait l'IP réelle du client.
 * Indispensable pour les plateformes PaaS derrière un Load Balancer.
 */
const getClientIp = (req) => {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (forwardedFor) return forwardedFor.split(',')[0].trim();
    return req.ip || 'unknown';
};

const getAllowedOrigins = () => {
    if (ENV.server.isProduction) {
        return ['https://ecomwatch.vercel.app', /\.vercel\.app$/];
    }
    return [];
};

const getOrigins = () => {
    const combined = [...ENV.cors.origins, ...getAllowedOrigins()];
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
            connectSrc: [
                "'self'",
                'https://ecomwatch.vercel.app',
                'https://o4510681965199360.ingest.de.sentry.io',
            ],
            objectSrc: ["'none'"],
            frameSrc: ["'none'"],
            upgradeInsecureRequests: [],
        },
    },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
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
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
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
 * Limiteur général — adapté aux mutations fréquentes du panier
 * (ajout/suppression à chaque interaction UI).
 */
export const generalLimiter = rateLimit({
    windowMs: ENV.rateLimit.windowMs,
    max: ENV.rateLimit.max,
    validate: { ip: false },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `cart:${getClientIp(req)}:${req.user?.id || 'anonymous'}`,
    handler: (req, res) => {
        logInfo(`Rate limit cart dépassé : IP=${getClientIp(req)}, User=${req.user?.id}`);
        res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
            status: HTTP_STATUS.TOO_MANY_REQUESTS,
            message: 'Trop de requêtes. Veuillez patienter.',
        });
    },
});

// ================================================================
// 404
// ================================================================

export const notFound = (req, _res, next) => {
    next(new NotFoundError('Route', req.originalUrl));
};
