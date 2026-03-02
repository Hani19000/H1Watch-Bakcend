/**
 * @module Middleware/RateLimiter
 *
 * Re-exporte les limiteurs définis dans config/security.js pour qu'ils soient
 * utilisables comme middlewares Express directement depuis ce dossier,
 * sans créer de couplage entre les routes et le module de configuration.
 */
import { generalLimiter, authLimiter } from '../config/security.js';

export { generalLimiter, authLimiter };