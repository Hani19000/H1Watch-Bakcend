/**
 * @module Controller/Auth
 *
 * Gère l'inscription, la connexion, le cycle de vie des tokens
 * et la réinitialisation de mot de passe.
 *
 * Le contrôleur est responsable des cookies (pas le service) : cela maintient
 * le service testable sans dépendance à l'objet Response d'Express.
 */
import { authService } from '../services/auth.service.js';
import { passwordResetService } from '../services/passwordreset.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';


const REFRESH_TOKEN_COOKIE_OPTIONS = {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: 7 * 24 * 60 * 60 * 1000,
};

class AuthController {
    register = asyncHandler(async (req, res) => {
        const result = await authService.register(req.body);

        res.cookie('refreshToken', result.refreshToken, REFRESH_TOKEN_COOKIE_OPTIONS);

        res.status(HTTP_STATUS.CREATED).json({
            status: 'success',
            data: {
                user: result.user,
                accessToken: result.accessToken,
                claimedOrders: result.claimedOrders || 0,
                claimedOrderNumbers: result.claimedOrderNumbers || [],
            },
        });
    });

    login = asyncHandler(async (req, res) => {
        const { email, password } = req.body;
        const result = await authService.login({ email, password });

        res.cookie('refreshToken', result.refreshToken, REFRESH_TOKEN_COOKIE_OPTIONS);

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: {
                user: result.user,
                accessToken: result.accessToken,
                claimedOrders: result.claimedOrders || 0,
                claimedOrderNumbers: result.claimedOrderNumbers || [],
            },
        });
    });

    logout = asyncHandler(async (req, res) => {
        const { refreshToken } = req.cookies;
        await authService.logout(refreshToken);

        res.clearCookie('refreshToken');
        res.status(HTTP_STATUS.OK).json({ status: 'success', message: 'Déconnecté' });
    });

    refresh = asyncHandler(async (req, res) => {
        const { refreshToken } = req.cookies;
        const result = await authService.refreshAccessToken(refreshToken);

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: {
                accessToken: result.accessToken,
                user: result.user,
            },
        });
    });

    /**
     * POST /api/v1/auth/forgot-password
     *
     * Réponse volontairement identique qu'un compte existe ou non
     * pour ne pas révéler l'existence d'une adresse email (anti-énumération).
     */
    requestPasswordReset = asyncHandler(async (req, res) => {
        const { email } = req.body;

        await passwordResetService.requestReset(email);

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            message: 'Si un compte est associé à cet email, un lien de réinitialisation a été envoyé.',
        });
    });

    /**
     * POST /api/v1/auth/reset-password
     *
     * Consomme le token à usage unique et met à jour le mot de passe.
     * Invalide toutes les sessions actives après le reset.
     */
    resetPassword = asyncHandler(async (req, res) => {
        const { token, newPassword } = req.body;

        await passwordResetService.resetPassword(token, newPassword);

        // On efface le cookie de session au cas où l'utilisateur
        // serait encore connecté sur cet appareil
        res.clearCookie('refreshToken');

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            message: 'Mot de passe réinitialisé avec succès. Veuillez vous reconnecter.',
        });
    });
}

export const authController = new AuthController();