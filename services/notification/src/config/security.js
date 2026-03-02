/**
 * @module Config/Security
 *
 * Middlewares de sécurité du notification-service.
 *
 * Ce service n'expose que des routes internes (/internal/*) et de healthcheck.
 * Le rate limiter interne est intentionnellement généreux : les appelants sont
 * des services de confiance, non des clients publics.
 */
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { ENV } from './environment.js';
import { NotFoundError } from '../utils/appError.js';

// Normalise l'IP pour que les proxys IPv6 ne contournent pas le rate limiter
const getClientIp = (req) => ipKeyGenerator(req);

export const helmetMiddleware = helmet();

export const corsMiddleware = cors({
    origin: ENV.server.isProduction
        ? ['https://ecomwatch.vercel.app', /\.vercel\.app$/]
        : true,
    credentials: true,
    methods: ['GET', 'POST'],
});

export const compressResponse = compression();

/**
 * Rate limiter sur les routes internes d'enqueue.
 * Protège contre un service défaillant qui spammerait la queue.
 * Les services légitimes envoient au plus quelques centaines de jobs par minute.
 */
export const enqueueLimiter = rateLimit({
    windowMs: 60_000,      // 1 minute
    max: 500,              // 500 enqueue/min par service (IP)
    keyGenerator: getClientIp,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
        status: 'fail',
        message: 'Trop de requêtes — réessayez dans un instant',
    },
});

export const notFound = (_req, _res, next) => {
    next(new NotFoundError('Route'));
};
