/**
 * @module Service/Role
 *
 * Gère les attributions de rôles et les règles de sécurité RBAC.
 */
import { rolesRepo, usersRepo } from '../repositories/index.js';
import { AppError, ConflictError, BusinessError } from '../utils/appError.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';

class RoleService {
    // Rôles protégés en dur pour éviter qu'une suppression accidentelle
    // ne casse l'ensemble du système d'autorisation.
    #systemRoles = ['ADMIN', 'USER', 'MODERATOR'];

    constructor() {
        if (RoleService.instance) return RoleService.instance;
        RoleService.instance = this;
        Object.freeze(this);
    }

    async getAllRoles() {
        return await rolesRepo.findAll();
    }

    async assignRoleToUser(userId, roleName) {
        const role = await rolesRepo.findByName(roleName.toUpperCase());
        if (!role) throw new AppError(`Rôle ${roleName} inexistant`, HTTP_STATUS.NOT_FOUND);

        const user = await usersRepo.findById(userId);
        if (!user) throw new AppError('Utilisateur introuvable', HTTP_STATUS.NOT_FOUND);

        // Vérification avant insertion pour retourner un message explicite
        // plutôt que de se reposer silencieusement sur ON CONFLICT DO NOTHING.
        const userRoles = await rolesRepo.listUserRoles(userId);
        const hasRole = userRoles.some((r) => r.id === role.id);

        if (hasRole) {
            return { message: "L'utilisateur possède déjà ce rôle", userId, roleId: role.id };
        }

        return await rolesRepo.addUserRole(userId, role.id);
    }

    async removeRoleFromUser(userId, roleName) {
        const role = await rolesRepo.findByName(roleName.toUpperCase());
        if (!role) throw new AppError('Rôle introuvable', HTTP_STATUS.NOT_FOUND);

        // Garantir qu'il reste toujours au moins un administrateur
        // pour éviter un verrouillage total de l'application.
        if (roleName.toUpperCase() === 'ADMIN') {
            const admins = await rolesRepo.countUsersByRole(role.id);
            if (admins <= 1) {
                throw new BusinessError(
                    'Action impossible : il doit rester au moins un administrateur'
                );
            }
        }

        return await rolesRepo.removeUserRole(userId, role.id);
    }

    async createCustomRole(name, description) {
        const normalizedName = name.toUpperCase();

        const existing = await rolesRepo.findByName(normalizedName);
        if (existing) throw new ConflictError('Ce rôle existe déjà');

        return await rolesRepo.create({ name: normalizedName, description });
    }

    /**
     * Les rôles système ne peuvent pas être supprimés car ils sont référencés
     * en dur dans les middlewares d'autorisation.
     */
    async deleteRole(roleId) {
        const role = await rolesRepo.findById(roleId);
        if (!role) throw new AppError('Rôle introuvable', HTTP_STATUS.NOT_FOUND);

        if (this.#systemRoles.includes(role.name)) {
            throw new AppError('Impossible de supprimer un rôle système', HTTP_STATUS.FORBIDDEN);
        }

        return await rolesRepo.delete(roleId);
    }
}

export const roleService = new RoleService();