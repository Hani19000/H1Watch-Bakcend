/**
 * @module Middleware/OptionalAuth
 *
 * Authentification optionnelle — ne bloque pas si l'utilisateur n'est pas connecté.
 * Utilisé pour les flux guest : création de session Stripe, vérification de statut.
 *
 * Token valide  → req.user est hydraté depuis le payload JWT (stateless, pas de DB)
 * Token absent  → req.user = undefined, la requête continue en mode guest
 * Token invalide → req.user = undefined, la requête continue en mode guest
 *
 * Même principe stateless que auth.middleware.js :
 * le payment-service ne possède pas le schéma auth et ne doit pas y accéder.
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

        req.user = {
            id: decoded.sub || decoded.id,
            email: decoded.email,
            roles: decoded.roles ?? [],
        };

        next();
    } catch {
        // Token malformé ou signature invalide — on continue en mode guest
        // sans bloquer la requête ni exposer l'erreur interne.
        req.user = undefined;
        next();
    }
});
