/**
 * @module Utils/AsyncHandler
 *
 * Wrapper pour les contrôleurs Express asynchrones.
 * Sans ce wrapper, un `throw` ou un `await` rejeté dans un contrôleur
 * ne serait pas intercepté par le gestionnaire d'erreurs central d'Express.
 */
export const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};