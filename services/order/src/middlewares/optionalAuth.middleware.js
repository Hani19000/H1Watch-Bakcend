/**
 * @module Middleware/OptionalAuth
 *
 * Middleware d'authentification optionnelle (Version Microservice).
 * Contrairement à `protect`, ne bloque pas la requête si l'utilisateur n'est pas authentifié.
 * Hydrate req.user DIRECTEMENT depuis le token JWT sans interroger la DB.
 */
import { tokenService } from '../services/token.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const optionalAuth = asyncHandler(async (req, _res, next) => {
    let token;
    if (req.headers.authorization?.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        req.user = undefined;
        return next();
    }

    try {
        const decoded = tokenService.verifyAccessToken(token);

        if (!decoded) {
            req.user = undefined;
            return next();
        }

        // Hydratation de req.user avec les données cryptées dans le JWT
        // Plus aucune requête vers usersRepo ou rolesRepo n'est nécessaire !
        req.user = {
            id: decoded.sub || decoded.id,
            email: decoded.email,
            roles: decoded.roles || [],
        };

        next();
    } catch {
        // Token malformé, expiré ou erreur de signature — on continue en guest
        req.user = undefined;
        next();
    }
});