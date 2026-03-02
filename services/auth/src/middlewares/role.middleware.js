/**
 * @module Middleware/Role
 *
 * Contrôle d'accès par rôle (RBAC).
 * Doit obligatoirement être placé après le middleware `protect`,
 * qui est responsable de l'hydratation de req.user.roles.
 */
import { AppError } from '../utils/appError.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';

/**
 * Restreint l'accès aux utilisateurs possédant au moins un des rôles autorisés.
 * Accepter plusieurs rôles permet de partager une route entre USER et ADMIN
 * sans dupliquer les handlers.
 *
 * @param {...string} allowedRoles - Rôles autorisés à accéder à la route
 */
export const restrictTo = (...allowedRoles) => {
    return (req, _res, next) => {
        if (!req.user?.roles) {
            return next(new AppError('Utilisateur non authentifié', HTTP_STATUS.UNAUTHORIZED));
        }

        // Une intersection non vide entre les rôles de l'utilisateur et les rôles requis suffit
        const hasPermission = req.user.roles.some((userRole) => allowedRoles.includes(userRole));

        if (!hasPermission) {
            return next(new AppError("Vous n'avez pas les permissions pour effectuer cette action", HTTP_STATUS.FORBIDDEN));
        }

        next();
    };
};