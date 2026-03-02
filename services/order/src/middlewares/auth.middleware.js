/**
 * @module Middleware/Auth
 *
 * Protège les routes en vérifiant le JWT Access Token présent dans le header Authorization.
 *
 * Contrairement au monolith, ce middleware est **stateless** : il vérifie la signature
 * du token et extrait le payload sans requête en base. Les données utilisateur
 * (id, email, roles) étant signées dans le JWT par l'auth-service, cette approche
 * est sécurisée et performante pour un microservice sans session propre.
 *
 * La durée de vie courte du token (15 min) limite l'impact d'un token compromis
 * sans nécessiter de validation en base à chaque requête.
 */
import { tokenService } from '../services/token.service.js';
import { AppError } from '../utils/appError.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const protect = asyncHandler(async (req, _res, next) => {
    let token;

    if (req.headers.authorization?.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        throw new AppError('Accès refusé. Veuillez vous connecter.', HTTP_STATUS.UNAUTHORIZED);
    }

    const decoded = tokenService.verifyAccessToken(token);

    if (!decoded) {
        throw new AppError('Token invalide ou expiré.', HTTP_STATUS.UNAUTHORIZED);
    }

    // Hydrate req.user depuis le payload JWT — pas de requête DB.
    // Le payload est signé : toute falsification invalide la signature.
    req.user = {
        id: decoded.sub,
        email: decoded.email,
        roles: decoded.roles ?? [],
    };

    next();
});