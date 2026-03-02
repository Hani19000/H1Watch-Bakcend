/**
 * @module Middleware/OptionalAuth
 *
 * Middleware d'authentification optionnelle.
 * Contrairement à `protect`, ne bloque pas la requête si l'utilisateur n'est pas authentifié.
 * Utilisé pour les flux guest : checkout, pages publiques avec contenu personnalisé.
 *
 * Token valide  → req.user est hydraté avec les données utilisateur et ses rôles.
 * Token absent ou invalide → req.user reste undefined, la requête continue normalement.
 */
import { tokenService } from '../services/token.service.js';
import { usersRepo, rolesRepo } from '../repositories/index.js';
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

        const user = await usersRepo.findById(decoded.id || decoded.sub);

        if (!user) {
            req.user = undefined;
            return next();
        }

        const roles = await rolesRepo.listUserRoles(user.id);

        req.user = {
            ...user,
            roles: roles.map((role) => role.name),
        };

        next();
    } catch {
        // Token malformé ou erreur DB — on continue sans authentification
        req.user = undefined;
        next();
    }
});