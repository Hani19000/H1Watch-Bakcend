/**
 * @module Routes/Auth
 *
 * Routes d'authentification et de gestion du cycle de vie des sessions.
 */
import { Router } from 'express';
import { authController } from '../controllers/auth.controller.js';
import { validateEmail, validatePasswordStrength, validateRequired } from '../utils/validation.js';
import { authLimiter, passwordResetLimiter } from '../config/security.js';

const router = Router();

// ─── Inscription ──────────────────────────────────────────────────────────────
router.post('/register',
    authLimiter,
    (req, _res, next) => {
        validateRequired(req.body, ['email', 'password', 'firstName', 'lastName']);
        validateEmail(req.body.email);
        validatePasswordStrength(req.body.password);
        next();
    },
    authController.register
);

// ─── Connexion ────────────────────────────────────────────────────────────────
router.post('/login',
    authLimiter,
    (req, _res, next) => {
        validateRequired(req.body, ['email', 'password']);
        validateEmail(req.body.email);
        next();
    },
    authController.login
);

// ─── Session ──────────────────────────────────────────────────────────────────
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);

// ─── Réinitialisation de mot de passe ─────────────────────────────────────────

/**
 * POST /api/v1/auth/forgot-password
 *
 * Rate limit strict (5 req/heure) : prévient l'abus d'envoi d'emails.
 * Validation minimale volontaire : on ne révèle pas si l'email existe.
 */
router.post('/forgot-password',
    passwordResetLimiter,
    (req, _res, next) => {
        validateRequired(req.body, ['email']);
        validateEmail(req.body.email);
        next();
    },
    authController.requestPasswordReset
);

/**
 * POST /api/v1/auth/reset-password
 *
 * Rate limit partagé avec forgot-password.
 * Le token et le nouveau mot de passe sont validés avant d'atteindre le service.
 */
router.post('/reset-password',
    passwordResetLimiter,
    (req, _res, next) => {
        validateRequired(req.body, ['token', 'newPassword']);
        validatePasswordStrength(req.body.newPassword);
        next();
    },
    authController.resetPassword
);

export default router;