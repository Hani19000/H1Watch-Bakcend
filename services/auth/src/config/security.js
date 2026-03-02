import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { ENV } from './environment.js';
import { ERRORS } from '../constants/errors.js';
import { logInfo } from '../utils/logger.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { NotFoundError } from '../utils/appError.js';

// ================================================================
// UTILITAIRES INTERNES
// ================================================================

/**
 * Extrait l'IP réelle du client.
 * Indispensable pour les plateformes PaaS (Render, Heroku, Vercel) qui
 * placent l'app derrière un Load Balancer.
 */
const getClientIp = (req) => {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (forwardedFor) {
        return forwardedFor.split(',')[0].trim();
    }
    return req.ip || 'unknown';
};

const getAllowedOrigins = () => {
    if (ENV.server.nodeEnv === 'production') {
        return ['https://ecomwatch.vercel.app', /\.vercel\.app$/];
    }
    return [];
};

// Fusion intelligente des origines .env et des origines par défaut
const getOrigins = () => {
    const envOrigins = process.env.CORS_ORIGINS?.split(',').map((origin) => origin.trim()) || [];
    const defaultOrigins = getAllowedOrigins();
    const combined = [...envOrigins, ...defaultOrigins];

    const uniqueStrings = [...new Set(combined.filter((origin) => typeof origin === 'string'))];
    const regexes = combined.filter((origin) => origin instanceof RegExp);

    return [...uniqueStrings, ...regexes];
};

const origins = getOrigins();

// ================================================================
// MIDDLEWARES DE SÉCURITÉ (GLOBAL)
// ================================================================

/**
 * Définit la Content Security Policy (CSP) pour bloquer les scripts malveillants.
 */
export const helmetMiddleware = helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'blob:', 'https://res.cloudinary.com'],
            connectSrc: [
                "'self'",
                'https://ecomwatch.vercel.app',
                'https://ecom-watch.onrender.com',
                'https://o4510681965199360.ingest.de.sentry.io',
            ],
            fontSrc: ["'self'", 'data:'],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
            upgradeInsecureRequests: [],
        },
    },
    hsts: {
        maxAge: 31536000, // 1 an
        includeSubDomains: true,
        preload: true,
    },
});

/**
 * Vérifie strictement l'origine des requêtes.
 */
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
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true,
});

/**
 * Filtre personnalisé pour désactiver la compression via header si besoin.
 */
export const compressResponse = compression({
    filter: (req, res) => {
        if (req.headers['x-no-compression']) return false;
        return compression.filter(req, res);
    },
    level: 6, // Bon compromis CPU / Taille
});

// ================================================================
// RATE LIMITERS
// ================================================================

/**
 * Limiteur Global — premier rempart contre le scraping massif et les attaques DDoS.
 */
export const generalLimiter = rateLimit({
    windowMs: ENV.rateLimit.windowMs,
    max: ENV.rateLimit.max,
    validate: { ip: false },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => getClientIp(req),
});

/**
 * Limiteur Authentification — strict pour empêcher le brute-force sur les identifiants.
 */
export const authLimiter = rateLimit({
    windowMs: ENV.rateLimit.authWindowMs,
    max: ENV.rateLimit.authMax,
    validate: { ip: false },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => getClientIp(req),
    handler: (req, res) => {
        logInfo(`Tentative de spam détectée depuis l'IP : ${getClientIp(req)}`);
        res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
            status: HTTP_STATUS.TOO_MANY_REQUESTS,
            error: ERRORS.AUTH.TOO_MANY_ATTEMPTS,
            message: 'Trop de tentatives, veuillez réessayer plus tard.',
        });
    },
});

/**
 * Limiteur Changement de Mot de Passe — protège contre le brute-force de l'ancien mot de passe.
 */
export const passwordChangeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 3,
    validate: { ip: false },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `password-change:${getClientIp(req)}:${req.user?.id || 'anonymous'}`,
    handler: (req, res) => {
        logInfo(
            `Rate limit changement MDP dépassé : IP=${getClientIp(req)}, User=${req.user?.id || 'anonymous'}`
        );
        res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
            status: HTTP_STATUS.TOO_MANY_REQUESTS,
            error: 'TOO_MANY_ATTEMPTS',
            message: 'Trop de tentatives de changement de mot de passe. Veuillez réessayer dans 15 minutes.',
            retryAfter: '15 minutes',
        });
    },
});

/**
 * Limiteur Suivi de Commande Guest — protège contre l'énumération des IDs de commande.
 */
export const trackingGuestLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5000,
    validate: { ip: false },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `tracking-guest:${getClientIp(req)}`,
    handler: (req, res) => {
        logInfo(`Rate limit suivi guest dépassé : IP=${getClientIp(req)}`);
        res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
            status: HTTP_STATUS.TOO_MANY_REQUESTS,
            error: 'TOO_MANY_ATTEMPTS',
            message: 'Trop de tentatives de recherche. Veuillez réessayer dans 15 minutes.',
            retryAfter: '15 minutes',
        });
    },
});

/**
 * Limiteur Profil Utilisateur — permissif pour autoriser la navigation normale et le polling.
 */
export const profileGeneralLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5000,
    validate: { ip: false },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) =>
        `profile-general:${getClientIp(req)}:${req.user?.id || 'anonymous'}`,
    handler: (req, res) => {
        logInfo(
            `Rate limit profil général dépassé : IP=${getClientIp(req)}, User=${req.user?.id || 'anonymous'}`
        );
        res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
            status: HTTP_STATUS.TOO_MANY_REQUESTS,
            error: 'TOO_MANY_REQUESTS',
            message: 'Trop de requêtes. Veuillez réessayer dans 15 minutes.',
            retryAfter: '15 minutes',
        });
    },
});

/**
 * Limiteur Réinitialisation de Mot de Passe — clé par IP uniquement car l'utilisateur est déconnecté.
 */
export const passwordResetLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 heure
    max: 5,
    validate: { ip: false },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `password-reset:${getClientIp(req)}`,
    handler: (req, res) => {
        logInfo(`Rate limit reset MDP dépassé : IP=${getClientIp(req)}`);
        res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
            status: HTTP_STATUS.TOO_MANY_REQUESTS,
            error: 'TOO_MANY_ATTEMPTS',
            message: 'Trop de tentatives. Veuillez réessayer dans une heure.',
            retryAfter: '1 heure',
        });
    },
});

// ================================================================
// GESTION DES ERREURS
// ================================================================

/**
 * Middleware 404 — intercepte toutes les requêtes sans route correspondante.
 */
export const notFound = (req, _res, next) => {
    next(new NotFoundError('Route', req.originalUrl));
};