/**
 * @module Utils/AsyncHandler
 *
 * Encapsule les handlers Express async pour propager les erreurs
 * vers le middleware global sans try/catch répété.
 */
export const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};
