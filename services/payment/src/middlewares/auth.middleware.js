/**
 * @module Middleware/Auth
 *
 * Protège les routes en vérifiant le JWT Access Token.
 *
 * Ce middleware est intentionnellement STATELESS : il vérifie la signature du token
 * et extrait le payload sans aucune requête en base de données.
 *
 * Pourquoi stateless dans un microservice :
 *   - Le payment-service ne possède pas le schéma auth → pas d'accès à auth.users
 *   - Les données utilisateur (id, email, roles) sont signées dans le JWT par l'auth-service
 *   - La durée de vie courte du token (15 min) limite l'impact d'un token compromis
 *   - Chaque requête en base pour valider un token ajouterait ~5-20ms inutilement
 *
 * Hydrate req.user avec : { id, email, roles }
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

    // Hydratation de req.user depuis le payload signé — pas de requête DB.
    // decoded.sub est le standard JWT pour l'identifiant sujet (userId).
    req.user = {
        id: decoded.sub || decoded.id,
        email: decoded.email,
        roles: decoded.roles ?? [],
    };

    next();
});
