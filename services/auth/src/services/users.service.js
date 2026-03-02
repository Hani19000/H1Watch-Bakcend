/**
 * @module Service/User
 *
 * Gère la logique métier des utilisateurs : profil, rôles et changement de mot de passe.
 *
 * MICROSERVICE :
 * - ordersRepo (import direct monolithe) remplacé par orderClient (appel HTTP)
 * - getUserProfile dégrade gracieusement si order-service est indisponible (stats = null)
 */
import { usersRepo, rolesRepo } from '../repositories/index.js';
import { AppError, BusinessError } from '../utils/appError.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { passwordService } from './password.service.js';
import { orderClient } from '../clients/order.client.js';
import { cacheService } from './cache.service.js';

class UserService {
    constructor() {
        if (UserService.instance) return UserService.instance;
        UserService.instance = this;
        Object.freeze(this);
    }

    /**
     * Récupère le profil complet d'un utilisateur avec ses statistiques de commande.
     * Mis en cache 15 minutes pour garder les statistiques fraîches sans surcharger la DB.
     * Si order-service est indisponible, le profil est retourné sans les stats (dégradation gracieuse).
     */
    async getUserProfile(userId) {
        const cacheKey = `user:profile:full:${userId}`;

        const cachedData = await cacheService.get(cacheKey);
        if (cachedData) return cachedData;

        const user = await usersRepo.findById(userId);
        if (!user) throw new AppError('Utilisateur introuvable', HTTP_STATUS.NOT_FOUND);

        const roles = await rolesRepo.listUserRoles(userId);

        // Appel HTTP vers order-service — null si indisponible, ne bloque pas le profil
        const stats = await orderClient.getUserStats(userId);

        const fullProfile = {
            ...user,
            roles: roles.map((r) => r.name),
            stats,
        };

        await cacheService.set(cacheKey, fullProfile, 900);
        return fullProfile;
    }

    /**
     * Liste tous les utilisateurs enrichis de leurs rôles.
     * Résultat non mis en cache car utilisé en administration (fraîcheur prioritaire).
     */
    async listAllUsers(params = {}) {
        const result = await usersRepo.list(params);

        const usersWithRoles = await Promise.all(
            result.users.map(async (user) => {
                const roles = await rolesRepo.listUserRoles(user.id);
                return { ...user, roles: roles.map((r) => r.name) };
            })
        );

        return {
            users: usersWithRoles,
            pagination: result.pagination,
        };
    }

    async deleteUser(targetUserId, currentAdminId) {
        if (targetUserId === currentAdminId) {
            throw new AppError(
                'Opération interdite : Vous ne pouvez pas supprimer votre propre compte.',
                HTTP_STATUS.FORBIDDEN
            );
        }

        const targetUserRoles = await rolesRepo.listUserRoles(targetUserId);
        const isTargetAdmin = targetUserRoles.some((r) => r.name.toUpperCase() === 'ADMIN');
        if (isTargetAdmin) {
            throw new AppError(
                'Opération interdite : Vous ne pouvez pas supprimer un compte Administrateur.',
                HTTP_STATUS.FORBIDDEN
            );
        }

        const deleted = await usersRepo.deleteById(targetUserId);
        if (!deleted) throw new AppError('Erreur lors de la suppression', HTTP_STATUS.INTERNAL_SERVER_ERROR);

        await this.#clearUserCache(targetUserId);
        return true;
    }

    async updatePrivileges(targetUserId, { role, isActive }, currentAdminId) {
        const user = await usersRepo.findById(targetUserId);
        if (!user) throw new AppError('Utilisateur introuvable', HTTP_STATUS.NOT_FOUND);

        if (targetUserId === currentAdminId) {
            throw new AppError(
                'Opération interdite : Vous ne pouvez pas modifier vos propres accès.',
                HTTP_STATUS.FORBIDDEN
            );
        }

        const currentRoles = await rolesRepo.listUserRoles(targetUserId);
        const isAdmin = currentRoles.some((r) => r.name.toUpperCase() === 'ADMIN');

        if (isAdmin) {
            throw new AppError(
                "Opération interdite : Impossible de modifier les accès d'un autre Administrateur.",
                HTTP_STATUS.FORBIDDEN
            );
        }

        if (isActive !== undefined) {
            await usersRepo.setActive(targetUserId, isActive);
        }

        if (role) {
            const targetRoleName = role.toUpperCase();

            if (targetRoleName === 'ADMIN' && !isAdmin) {
                const adminRoleDef = await rolesRepo.findByName('ADMIN');
                if (adminRoleDef) await rolesRepo.addUserRole(targetUserId, adminRoleDef.id);
            } else if (targetRoleName === 'USER' && isAdmin) {
                const adminRoleAssigned = currentRoles.find((r) => r.name.toUpperCase() === 'ADMIN');
                if (adminRoleAssigned) await rolesRepo.removeUserRole(targetUserId, adminRoleAssigned.id);

                const userRoleDef = await rolesRepo.findByName('USER');
                const hasUserRole = currentRoles.some((r) => r.name.toUpperCase() === 'USER');
                if (userRoleDef && !hasUserRole) await rolesRepo.addUserRole(targetUserId, userRoleDef.id);
            }
        }

        await this.#clearUserCache(targetUserId);
        return this.getUserProfile(targetUserId);
    }

    async getProfile(userId) {
        const user = await usersRepo.findById(userId);
        if (!user) throw new AppError('Utilisateur non trouvé', HTTP_STATUS.NOT_FOUND);

        delete user.passwordHash;
        delete user.salt;
        return user;
    }

    async changePassword(userId, { oldPassword, newPassword }) {
        const user = await usersRepo.findById(userId);

        const isCurrentMatch = await passwordService.comparePassword(
            oldPassword,
            user.passwordHash,
            user.salt
        );
        if (!isCurrentMatch) {
            throw new AppError('Ancien mot de passe incorrect', HTTP_STATUS.UNAUTHORIZED);
        }

        const history = await usersRepo.getPasswordHistory(userId, 2);
        const allEntriesToCheck = [
            { passwordHash: user.passwordHash, salt: user.salt },
            ...history,
        ];

        for (const entry of allEntriesToCheck) {
            const isAlreadyUsed = await passwordService.comparePassword(
                newPassword,
                entry.passwordHash,
                entry.salt
            );
            if (isAlreadyUsed) {
                throw new BusinessError(
                    'Vous ne pouvez pas réutiliser un de vos anciens mots de passe.'
                );
            }
        }

        await usersRepo.addToHistory(userId, user.passwordHash, user.salt);

        const newSalt = passwordService.generateSalt();
        const newHash = await passwordService.hashPassword(newPassword, newSalt);

        const result = await usersRepo.updateCredentials(userId, {
            passwordHash: newHash,
            salt: newSalt,
        });

        await this.#clearUserCache(userId);
        return result;
    }

    async #clearUserCache(userId) {
        const keys = [
            `user:profile:full:${userId}`,
            `user:profile:basic:${userId}`,
        ];
        await Promise.all(keys.map((key) => cacheService.delete(key)));
    }
}

export const userService = new UserService();