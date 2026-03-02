/**
 * @module Middleware/RateLimiter
 *
 * Re-exporte les limiteurs définis dans config/security.js pour qu'ils soient
 * importables directement depuis le dossier middlewares, sans couplage direct
 * entre les routes et le module de configuration.
 *
 * Limiteurs disponibles dans le payment-service :
 *   - generalLimiter  : rempart global sur toutes les routes
 *   - checkoutLimiter : strict sur la création de sessions Stripe (anti-fraude)
 *   - statusLimiter   : souple sur le polling de statut post-paiement
 */
import { generalLimiter, checkoutLimiter, statusLimiter } from '../config/security.js';

export { generalLimiter, checkoutLimiter, statusLimiter };
