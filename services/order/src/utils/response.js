/**
 * @module Utils/Response
 *
 * Helpers pour normaliser la forme de toutes les réponses HTTP.
 * Garantit que chaque réponse expose les mêmes champs (`success`, `data` / `message`),
 * ce qui simplifie la gestion côté client.
 */

/** Réponse de succès avec payload optionnel */
export const sendSuccess = (res, statusCode, data = null) => {
    res.status(statusCode).json({
        success: true,
        data,
    });
};

/** Réponse d'erreur avec message lisible par le client */
export const sendError = (res, statusCode, message) => {
    res.status(statusCode).json({
        success: false,
        message,
    });
};