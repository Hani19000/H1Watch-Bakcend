/**
 * @module Middleware/Validator
 *
 * Adaptateur entre les fonctions de validation (utils/validation.js) et Express.
 * Centraliser la conversion des erreurs de validation en réponses 400 ici
 * évite de dupliquer le try/catch dans chaque contrôleur.
 *
 * @param {Function} validationFn - Fonction qui valide les données et throw en cas d'échec
 * @param {string}   source       - Partie de la requête à valider : 'body' | 'query' | 'params' (défaut: 'body')
 */
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { AppError } from '../utils/appError.js';

export const validate = (validationFn, source = 'body') => (req, res, next) => {
    try {
        validationFn(req[source]);
        next();
    } catch (error) {
        // Les AppError (ValidationError, etc.) sont déjà formattées — on les propage telles quelles.
        // Les erreurs natives (ex: TypeError) sont normalisées en 400 pour ne pas laisser
        // une erreur non opérationnelle remonter jusqu'au client.
        if (error instanceof AppError) {
            next(error);
        } else {
            next(new AppError(error.message, HTTP_STATUS.BAD_REQUEST));
        }
    }
};