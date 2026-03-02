/**
 * @module Utils/AsyncHandler
 *
 * Wrapper pour les contrôleurs async.
 * Évite le try/catch répétitif en propageant les erreurs à Express via next().
 */
export const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};
