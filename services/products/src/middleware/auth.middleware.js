/**
 * @module Middleware/Auth
 *
 * Vérification stateless du JWT pour le product-service.
 * Pas de requête DB — le payload signé est la source de vérité.
 *
 * Le JWT est émis par l'auth-service. Le product-service le vérifie
 * uniquement avec `JWT_ACCESS_SECRET` partagé entre les services.
 *
 * Hydrate `req.user` avec : { id, email, roles }
 */
import jwt from 'jsonwebtoken';
import { AppError } from '../utils/appError.js';
import { ENV } from '../config/environment.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';

const extractToken = (req) => {
    // Priorité au header Authorization (API clients, SPA)
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
        return authHeader.split(' ')[1];
    }
    // Fallback cookie HttpOnly (navigation browser)
    return req.cookies?.accessToken || null;
};

/**
 * Middleware de protection — requiert un JWT valide.
 * Utiliser sur les routes ADMIN.
 */
export const protect = (req, res, next) => {
    const token = extractToken(req);

    if (!token) {
        return next(new AppError('Non authentifié. Veuillez vous connecter.', HTTP_STATUS.UNAUTHORIZED));
    }

    try {
        // CORRECTIF BUG 1 : la clé dans environment.js est `accessTokenSecret`, pas `accessSecret`.
        // ENV.jwt.accessSecret était `undefined` → jwt.verify() lançait une exception
        // → catch renvoyait systématiquement 401 sur toutes les routes protégées.
        const decoded = jwt.verify(token, ENV.jwt.accessTokenSecret);

        req.user = {
            id: decoded.sub,
            email: decoded.email,
            roles: decoded.roles || [],
        };

        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return next(new AppError('Session expirée. Veuillez vous reconnecter.', HTTP_STATUS.UNAUTHORIZED));
        }
        return next(new AppError('Token invalide.', HTTP_STATUS.UNAUTHORIZED));
    }
};

/**
 * Middleware optionnel — hydrate req.user si un token valide est présent.
 * Pas d'erreur si absent — pour les routes publiques avec contexte utilisateur optionnel.
 */
export const optionalAuth = (req, _res, next) => {
    const token = extractToken(req);
    if (!token) return next();

    try {
        const decoded = jwt.verify(token, ENV.jwt.accessSecret);
        req.user = {
            id: decoded.sub,
            email: decoded.email,
            roles: decoded.roles || [],
        };
    } catch {
        // Token invalide ignoré — route accessible sans auth
    }

    next();
};