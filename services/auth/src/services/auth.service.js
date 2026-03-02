/**
 * @module Service/Auth
 *
 * Orchestre l'inscription, la connexion et le renouvellement de session.
 *
 * SÉCURITÉ :
 * - Email normalisé (lowercase) pour éviter les doublons
 * - Messages génériques sur échec (pas de révélation d'existence email)
 * - Transactions atomiques (user + rôle en une seule opération)
 * - Notifications fire-and-forget (ne bloquent pas le flux principal)
 * - Auto-claim des commandes guest après inscription/connexion
 *   pour une meilleure expérience utilisateur (pas de panier perdu)
 *
 * MICROSERVICE :
 * - notificationService (import direct local) remplacé par notificationClient (HTTP)
 *   Les emails welcome sont délégués au notification-service centralisé.
 *   Résilience gérée côté notification-service (BullMQ 3 retries).
 */
import { usersRepo, rolesRepo } from '../repositories/index.js';
import { passwordService } from './password.service.js';
import { tokenService } from './token.service.js';
import { sessionService } from './session.service.js';
import { orderClient } from '../clients/order.client.js';
import { notificationClient } from '../clients/notification.client.js';
import { AppError, ConflictError } from '../utils/appError.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { pgPool } from '../config/database.js';
import { logInfo, logError } from '../utils/logger.js';

class AuthService {
    constructor() {
        if (AuthService.instance) return AuthService.instance;
        AuthService.instance = this;
        Object.freeze(this);
    }

    /**
     * Factorise la génération des tokens et la persistance de session.
     * Partagée entre register et login pour rester DRY.
     *
     * `roles` est inclus dans l'objet `user` retourné pour que le frontend
     * puisse appliquer l'affichage conditionnel (ex : lien dashboard admin)
     * dès le login, sans attendre un refresh.
     *
     * @param {{ id, email, firstName, roles: string[] }} user
     */
    async #createAuthSession(user) {
        const accessToken = tokenService.generateAccessToken(user);
        const refreshToken = tokenService.generateRefreshToken(user);

        await sessionService.createSession(user.id, refreshToken);

        return {
            user: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                roles: user.roles ?? [],
            },
            accessToken,
            refreshToken,
        };
    }

    /**
     * Inscription d'un nouvel utilisateur.
     *
     * Workflow :
     * 1. Vérification unicité email
     * 2. Création utilisateur + attribution rôle (transaction atomique)
     * 3. Notification d'inscription (fire-and-forget → notification-service)
     * 4. Auto-claim des commandes guest avec le même email
     * 5. Création de la session authentifiée
     */
    async register({ email, password, firstName, lastName }) {
        const existing = await usersRepo.findByEmail(email);
        if (existing) {
            throw new ConflictError('Email déjà utilisé');
        }

        const role = await rolesRepo.findByName('USER');
        if (!role) {
            throw new AppError(
                'Configuration serveur : rôle introuvable',
                HTTP_STATUS.INTERNAL_SERVER_ERROR
            );
        }

        const salt = passwordService.generateSalt();
        const passwordHash = await passwordService.hashPassword(password, salt);

        const client = await pgPool.connect();
        try {
            await client.query('BEGIN');

            const newUser = await usersRepo.create(
                { email, passwordHash, salt, firstName, lastName },
                client
            );

            await rolesRepo.addUserRole(newUser.id, role.id, client);

            await client.query('COMMIT');

            // Fire-and-forget — notificationClient ne lève jamais d'exception
            notificationClient.notifyWelcome(newUser.email, newUser);

            const claimResult = await orderClient.claimGuestOrders(
                newUser.id,
                email.trim().toLowerCase()
            );

            if (claimResult.claimed > 0) {
                logInfo(`${claimResult.claimed} commande(s) rattachée(s) à ${newUser.id}`);
            } else if (claimResult.error) {
                logError(new Error(claimResult.error), { context: 'auto-claim register', userId: newUser.id });
            }

            const userWithRoles = { ...newUser, roles: [role.name] };
            const session = await this.#createAuthSession(userWithRoles);

            return {
                ...session,
                claimedOrders: claimResult.claimed || 0,
                claimedOrderNumbers: claimResult.claimedOrderNumbers || [],
            };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Connexion d'un utilisateur.
     * Message générique sur échec pour ne pas révéler l'existence d'un compte.
     */
    async login({ email, password }) {
        const user = await usersRepo.findByEmail(email);

        if (!user) throw new AppError('Identifiants invalides', HTTP_STATUS.UNAUTHORIZED);

        if (user.isActive === false) {
            throw new AppError('Ce compte a été suspendu. Veuillez contacter le support.', HTTP_STATUS.FORBIDDEN);
        }

        const isValid = await passwordService.comparePassword(password, user.passwordHash, user.salt);
        if (!isValid) throw new AppError('Identifiants invalides', HTTP_STATUS.UNAUTHORIZED);

        const roles = await rolesRepo.listUserRoles(user.id);
        const userWithRoles = { ...user, roles: roles.map((r) => r.name) };

        const claimResult = await orderClient.claimGuestOrders(
            user.id,
            email.trim().toLowerCase()
        );

        if (claimResult.claimed > 0) {
            logInfo(`${claimResult.claimed} commande(s) rattachée(s) à ${user.id} lors de la connexion`);
        } else if (claimResult.error) {
            logError(new Error(claimResult.error), { context: 'auto-claim login', userId: user.id });
        }

        const session = await this.#createAuthSession(userWithRoles);

        return {
            ...session,
            claimedOrders: claimResult.claimed || 0,
            claimedOrderNumbers: claimResult.claimedOrderNumbers || [],
        };
    }

    /**
     * Déconnexion — supprime la session du whitelist (Redis + DB).
     * Silencieux si le refreshToken est absent ou invalide.
     */
    async logout(refreshToken) {
        if (!refreshToken) return;
        await sessionService.deleteSession(refreshToken);
    }

    async refreshAccessToken(refreshToken) {
        const payload = tokenService.verifyRefreshToken(refreshToken);
        if (!payload) {
            await sessionService.deleteSession(refreshToken);
            throw new AppError('Token expiré ou invalide', HTTP_STATUS.UNAUTHORIZED);
        }

        const session = await sessionService.validateSession(refreshToken);
        if (!session) {
            throw new AppError('Session invalide ou expirée', HTTP_STATUS.UNAUTHORIZED);
        }

        const user = await usersRepo.findById(payload.sub);
        if (!user) {
            await sessionService.deleteSession(refreshToken);
            throw new AppError('Utilisateur introuvable', HTTP_STATUS.UNAUTHORIZED);
        }

        const roles = await rolesRepo.listUserRoles(user.id);
        const userRoles = roles.map((r) => r.name);

        const accessToken = tokenService.generateAccessToken({ ...user, roles: userRoles });

        return {
            accessToken,
            user: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                roles: userRoles,
            },
        };
    }
}

export const authService = new AuthService();
