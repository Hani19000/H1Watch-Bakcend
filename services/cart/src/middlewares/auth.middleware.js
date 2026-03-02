/**
 * @module Middlewares/Auth
 *
 * Middleware de protection des routes du cart-service.
 * Valide le JWT Access Token émis par l'auth-service de façon stateless —
 * aucune requête DB : le payload signé garantit l'intégrité des données.
 *
 * Durée de vie courte (15 min par défaut) pour limiter l'impact d'un token compromis.
 */
import { tokenService } from '../services/token.service.js';
import { AppError } from '../utils/appError.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { ERRORS } from '../constants/errors.js';

export const protect = (req, _res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
        return next(new AppError(ERRORS.AUTH.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED));
    }

    const token = authHeader.split(' ')[1];
    const decoded = tokenService.verifyAccessToken(token);

    if (!decoded) {
        return next(new AppError(ERRORS.AUTH.TOKEN_INVALID, HTTP_STATUS.UNAUTHORIZED));
    }

    // Hydrate req.user depuis le payload JWT — aligné sur le format de l'auth-service
    req.user = {
        id: decoded.sub,
        email: decoded.email,
        roles: decoded.roles || [],
    };

    next();
};
