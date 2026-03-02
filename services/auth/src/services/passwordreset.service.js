/**
 * @module Service/PasswordReset
 *
 * Orchestre la réinitialisation de mot de passe via un lien email.
 *
 * SÉCURITÉ :
 * - Token brut 32 bytes (256 bits d'entropie), seul le hash SHA-256 est stocké
 * - TTL 1 heure, usage unique (supprimé à la consommation)
 * - Réponse identique si l'email existe ou non (anti-énumération)
 * - Invalidation de toutes les sessions actives après reset
 * - Vérification historique pour interdire la réutilisation des anciens mots de passe
 *
 * MICROSERVICE :
 * - notificationService (import direct local) remplacé par notificationClient (HTTP)
 *   Le resetUrl est construit ici car le notification-service ne connaît pas
 *   CLIENT_URL de l'auth-service.
 */
import crypto from 'crypto';
import { usersRepo } from '../repositories/index.js';
import { passwordResetRepo } from '../repositories/passwordreset.repo.js';
import { passwordService } from './password.service.js';
import { sessionService } from './session.service.js';
import { notificationClient } from '../clients/notification.client.js';
import { AppError, BusinessError } from '../utils/appError.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { ENV } from '../config/environment.js';
import { logInfo, logError } from '../utils/logger.js';

class PasswordResetService {
    constructor() {
        if (PasswordResetService.instance) return PasswordResetService.instance;
        PasswordResetService.instance = this;
        Object.freeze(this);
    }

    /**
     * Génère un token cryptographiquement sûr et retourne sa paire (brut, hash).
     * Le token brut part par email, le hash est stocké en base.
     *
     * @returns {{ rawToken: string, tokenHash: string }}
     */
    #generateToken() {
        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        return { rawToken, tokenHash };
    }

    /**
     * Initie une demande de réinitialisation de mot de passe.
     *
     * Si l'email n'existe pas, la réponse est identique (pas de révélation).
     * La notification est fire-and-forget pour ne pas exposer l'existence du compte
     * via un différentiel de temps de réponse.
     *
     * @param {string} email - Email saisi par l'utilisateur
     */
    async requestReset(email) {
        const normalizedEmail = email.trim().toLowerCase();
        const user = await usersRepo.findByEmail(normalizedEmail);

        // Sortie silencieuse : ne révèle pas si l'email est enregistré.
        if (!user) return;

        const { rawToken, tokenHash } = this.#generateToken();

        await passwordResetRepo.createToken(user.id, tokenHash);

        // Fire-and-forget — notificationClient ne lève jamais d'exception
        // Le resetUrl est construit ici car notification-service ne connaît pas CLIENT_URL
        const resetUrl = `${ENV.clientUrl}/reset-password?token=${rawToken}`;
        notificationClient.notifyPasswordReset(user.email, resetUrl);

        logInfo(`Demande de reset mot de passe pour userId=${user.id}`);
    }

    /**
     * Consomme le token et met à jour le mot de passe.
     *
     * Workflow :
     * 1. Hash du token reçu → recherche en base
     * 2. Vérification de l'utilisateur associé
     * 3. Contrôle historique (interdit la réutilisation des anciens mots de passe)
     * 4. Mise à jour des credentials
     * 5. Suppression du token (usage unique)
     * 6. Invalidation de toutes les sessions actives (sécurité post-compromission)
     *
     * @param {string} rawToken    - Token brut extrait du lien email
     * @param {string} newPassword - Nouveau mot de passe choisi par l'utilisateur
     */
    async resetPassword(rawToken, newPassword) {
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

        const tokenRecord = await passwordResetRepo.findValidToken(tokenHash);
        if (!tokenRecord) {
            throw new AppError('Lien invalide ou expiré', HTTP_STATUS.BAD_REQUEST);
        }

        const user = await usersRepo.findById(tokenRecord.userId);
        if (!user) {
            throw new AppError('Utilisateur introuvable', HTTP_STATUS.NOT_FOUND);
        }

        await this.#assertPasswordNotReused(user, newPassword);

        const newSalt = passwordService.generateSalt();
        const newHash = await passwordService.hashPassword(newPassword, newSalt);

        await usersRepo.addToHistory(user.id, user.passwordHash, user.salt);
        await usersRepo.updateCredentials(user.id, { passwordHash: newHash, salt: newSalt });

        // Usage unique : on supprime le token immédiatement après consommation.
        await passwordResetRepo.deleteToken(tokenHash);

        // Invalider toutes les sessions pour forcer une reconnexion propre.
        await this.#invalidateAllSessions(user.id);

        logInfo(`Mot de passe réinitialisé pour userId=${user.id}`);
    }

    /**
     * Vérifie que le nouveau mot de passe n'a pas déjà été utilisé.
     * Contrôle le mot de passe courant + les 2 dernières entrées de l'historique.
     *
     * @private
     * @throws {BusinessError} si le mot de passe est déjà connu
     */
    async #assertPasswordNotReused(user, newPassword) {
        const history = await usersRepo.getPasswordHistory(user.id, 2);
        const entriesToCheck = [
            { passwordHash: user.passwordHash, salt: user.salt },
            ...history,
        ];

        for (const entry of entriesToCheck) {
            const isReused = await passwordService.comparePassword(
                newPassword,
                entry.passwordHash,
                entry.salt
            );
            if (isReused) {
                throw new BusinessError(
                    'Vous ne pouvez pas réutiliser un de vos anciens mots de passe.'
                );
            }
        }
    }

    /**
     * Invalide toutes les sessions actives de l'utilisateur.
     * Silencieux en cas d'échec : le reset ne doit pas être bloqué par cette étape.
     *
     * @private
     */
    async #invalidateAllSessions(userId) {
        try {
            await sessionService.deleteAllUserSessions(userId);
        } catch (error) {
            logError(error, { context: 'PasswordResetService.invalidateAllSessions', userId });
        }
    }
}

export const passwordResetService = new PasswordResetService();
