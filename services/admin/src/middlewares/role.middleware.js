/**
 * @module Middleware/Role
 *
 * Contrôle d'accès par rôle (RBAC).
 * Doit être placé après `protect` qui hydrate req.user.roles.
 */
import { AppError } from '../utils/appError.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';

/**
 * Restreint l'accès aux utilisateurs possédant au moins un des rôles autorisés.
 *
 * @param {...string} allowedRoles - Rôles autorisés (ex: 'ADMIN')
 */
export const restrictTo = (...allowedRoles) => {
    return (req, _res, next) => {
        if (!req.user?.roles) {
            return next(new AppError('Utilisateur non authentifié', HTTP_STATUS.UNAUTHORIZED));
        }

        const hasPermission = req.user.roles.some((role) => allowedRoles.includes(role));

        if (!hasPermission) {
            return next(
                new AppError(
                    "Vous n'avez pas les permissions pour effectuer cette action",
                    HTTP_STATUS.FORBIDDEN
                )
            );
        }

        next();
    };
};
