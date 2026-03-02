/**
 * @module Middleware/ErrorHandler
 *
 * Gestionnaire d'erreurs global Express (4 paramètres obligatoires).
 * Doit être enregistré en dernier dans app.js, après toutes les routes.
 * Centralise le formatage des réponses d'erreur pour garantir une API cohérente.
 */
import { AppError } from '../utils/appError.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { ENV } from '../config/environment.js';
import { logError } from '../utils/logger.js';

/**
 * Transforme les erreurs brutes PostgreSQL en AppError lisibles.
 * Intercepter ici évite de laisser remonter des messages d'erreur DB
 * cryptiques (codes internes) jusqu'au client.
 */
const handlePostgresError = (err) => {
    // 23505 : violation d'unicité — ex: email déjà utilisé
    if (err.code === '23505') {
        const field = err.detail ? err.detail.match(/\((.*?)\)/)[1] : 'field';
        return new AppError(`La valeur pour '${field}' existe déjà.`, HTTP_STATUS.CONFLICT);
    }

    // 23503 : violation de clé étrangère — la ressource référencée n'existe pas
    if (err.code === '23503') {
        return new AppError('Opération impossible : ressource liée introuvable.', HTTP_STATUS.BAD_REQUEST);
    }

    // 22P02 : représentation invalide — ex: UUID malformé dans les paramètres d'URL
    if (err.code === '22P02') {
        return new AppError("Format de l'ID invalide.", HTTP_STATUS.BAD_REQUEST);
    }

    return err;
};

/**
 * En développement, on expose tous les détails (stack trace, objet d'erreur complet)
 * pour accélérer le diagnostic sans avoir à consulter les logs serveur.
 */
const sendErrorDev = (err, res) => {
    res.status(err.statusCode).json({
        status: err.status,
        error: err,
        message: err.message,
        stack: err.stack,
    });
};

/**
 * En production, on distingue deux cas :
 * - Erreur opérationnelle (AppError) : on peut exposer le message en toute sécurité.
 * - Erreur inattendue (bug) : on masque les détails pour ne pas exposer l'architecture interne.
 *   Sentry (initialisé dans instruments.js) capture automatiquement ces erreurs via son
 *   intégration Express — aucun appel Sentry explicite n'est nécessaire ici.
 */
const sendErrorProd = (err, res) => {
    if (err.isOperational) {
        res.status(err.statusCode).json({
            status: err.status,
            message: err.message,
        });
    } else {
        logError(err, { context: 'Unhandled error' });
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
            status: 'error',
            message: 'Une erreur interne est survenue.',
        });
    }
};

export const errorHandler = (err, _req, res, _next) => {
    err.statusCode = err.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR;
    err.status = err.status || 'error';

    if (ENV.server.nodeEnv === 'development') {
        sendErrorDev(err, res);
    } else {
        let error = { ...err };
        error.message = err.message;

        // Normalisation des erreurs tierces en AppError pour unifier le format de réponse
        if (error.code) error = handlePostgresError(error);
        if (error.name === 'JsonWebTokenError') error = new AppError('Token invalide.', HTTP_STATUS.UNAUTHORIZED);
        if (error.name === 'TokenExpiredError') error = new AppError('Token expiré.', HTTP_STATUS.UNAUTHORIZED);

        sendErrorProd(error, res);
    }
};