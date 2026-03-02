/**
 * @module Utils/AsyncHandler
 *
 * Encapsule les handlers Express async pour propager les erreurs vers
 * le middleware d'erreur global sans try/catch répété dans chaque contrôleur.
 */
export const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};