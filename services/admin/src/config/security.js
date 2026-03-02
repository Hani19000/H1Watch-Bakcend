/**
 * @module Config/Security
 *
 * Middlewares de sécurité HTTP centralisés.
 * Cohérent avec les autres services : helmet, CORS strict, rate limiting.
 */
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { ENV } from './environment.js';

// ── Helmet ────────────────────────────────────────────────────────────────────

export const helmetMiddleware = helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: [],
        },
    },
    hsts: { maxAge: 31536000, includeSubDomains: true },
});

// ── CORS ──────────────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = new Set(ENV.cors.origins);

/**
 * Valide l'origine contre la liste autorisée et les sous-domaines Vercel.
 * Les appels inter-services n'ont pas d'Origin header — ils passent directement.
 */
const isOriginAllowed = (origin) => {
    if (!origin) return true;
    if (ALLOWED_ORIGINS.has(origin)) return true;
    // Autorise les déploiements preview Vercel
    return /^https:\/\/.*\.vercel\.app$/.test(origin);
};

export const corsMiddleware = cors({
    origin: (origin, callback) => {
        if (isOriginAllowed(origin)) {
            callback(null, true);
        } else {
            callback(new Error(`CORS: origine non autorisée — ${origin}`));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-ID'],
});

// ── Compression ───────────────────────────────────────────────────────────────

export const compressResponse = compression({ level: 6 });

// ── Rate limiting ─────────────────────────────────────────────────────────────

/**
 * Toutes les routes admin sont réservées aux administrateurs authentifiés.
 * La limite est plus haute que pour les routes publiques car les dashboards
 * font plusieurs appels simultanés.
 */
export const adminLimiter = rateLimit({
    windowMs: ENV.rateLimit.windowMs,
    max: ENV.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        const forwarded = req.headers['x-forwarded-for'];
        return forwarded ? forwarded.split(',')[0].trim() : req.ip;
    },
});
