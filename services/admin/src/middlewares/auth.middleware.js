/**
 * @module Middlewares/Auth
 *
 * Valide le JWT Access Token émis par l'auth-service de façon stateless.
 * Aucune requête DB — le payload signé garantit l'intégrité.
 */
import jwt from 'jsonwebtoken';
import { ENV } from '../config/environment.js';
import { AppError } from '../utils/appError.js';

export const protect = (req, _res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
        return next(new AppError('Authentification requise', 401));
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, ENV.jwt.accessTokenSecret);
        req.user = {
            id: decoded.sub,
            email: decoded.email,
            roles: decoded.roles || [],
        };
        next();
    } catch {
        // Ne pas distinguer token expiré vs invalide pour éviter l'énumération
        next(new AppError('Token invalide ou expiré', 401));
    }
};

/**
 * Vérifie que l'utilisateur authentifié possède le rôle ADMIN.
 * Doit être appelé après `protect` qui hydrate req.user.roles.
 * Centralisé ici plutôt que dans role.middleware pour éviter un import
 * supplémentaire dans les routes — toutes les routes admin utilisent
 * systématiquement protect + requireAdmin ensemble.
 */
export const requireAdmin = (req, _res, next) => {
    const isAdmin = req.user?.roles?.some(
        (role) => role.toUpperCase() === 'ADMIN'
    );

    if (!isAdmin) {
        return next(
            new AppError("Vous n'avez pas les permissions pour accéder à cette ressource", 403)
        );
    }

    next();
};
