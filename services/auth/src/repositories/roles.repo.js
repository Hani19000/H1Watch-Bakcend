/**
 * @module Repository/Roles
 *
 * Gère les rôles applicatifs et leurs associations aux utilisateurs (RBAC).
 */
import { pgPool } from '../config/database.js';
import { mapRow, mapRows } from './_mappers.js';
import { validateUUID } from '../utils/validation.js';

export const rolesRepo = {
  /**
   * Liste tous les rôles disponibles.
   * Alias de findAll() pour les services qui utilisent la convention "list".
   */
  async list() {
    const { rows } = await pgPool.query(`SELECT * FROM roles ORDER BY id ASC`);
    return mapRows(rows);
  },

  /**
   * Liste tous les rôles disponibles.
   * Appelé par roles.service.js → getAllRoles().
   */
  async findAll() {
    return this.list();
  },

  async findByName(name) {
    const { rows } = await pgPool.query(
      `SELECT * FROM roles WHERE name = $1`,
      [name]
    );
    return mapRow(rows[0]);
  },

  /**
   * Récupère un rôle par son identifiant.
   * Appelé par roles.service.js → deleteRole() pour vérifier l'existence avant suppression.
   */
  async findById(id) {
    const { rows } = await pgPool.query(
      `SELECT * FROM roles WHERE id = $1`,
      [id]
    );
    return mapRow(rows[0]);
  },

  /**
   * Crée un rôle personnalisé.
   * Appelé par roles.service.js → createCustomRole().
   */
  async create({ name, description = null }) {
    const { rows } = await pgPool.query(
      `INSERT INTO roles (name, description)
             VALUES ($1, $2)
             RETURNING *`,
      [name, description]
    );
    return mapRow(rows[0]);
  },

  /**
   * Supprime un rôle par son identifiant.
   * Appelé par roles.service.js → deleteRole() après vérification que ce n'est pas un rôle système.
   */
  async delete(id) {
    const { rowCount } = await pgPool.query(
      `DELETE FROM roles WHERE id = $1`,
      [id]
    );
    return rowCount > 0;
  },

  /**
   * Compte le nombre d'utilisateurs ayant un rôle donné.
   * Appelé par roles.service.js → removeRoleFromUser() pour garantir
   * qu'au moins un administrateur reste toujours en place.
   */
  async countUsersByRole(roleId) {
    const { rows } = await pgPool.query(
      `SELECT COUNT(*) FROM user_roles WHERE role_id = $1`,
      [roleId]
    );
    return parseInt(rows[0].count, 10);
  },

  /**
   * Initialise les rôles par défaut en base.
   * ON CONFLICT DO NOTHING rend l'opération idempotente :
   * peut être appelée plusieurs fois sans effets de bord (migrations, seeds).
   */
  async seedDefaults() {
    await pgPool.query(
      `INSERT INTO roles (name) VALUES ('user'), ('admin'), ('visitor')
             ON CONFLICT (name) DO NOTHING`
    );
  },

  /**
   * Associe un rôle à un utilisateur via son ID.
   * Accepte un client de transaction pour s'intégrer dans un flux de création d'utilisateur atomique.
   * ON CONFLICT DO NOTHING garantit l'idempotence si l'association existe déjà.
   */
  async addUserRole(userId, roleId, client = pgPool) {
    validateUUID(userId, 'userId');

    const { rows } = await client.query(
      `INSERT INTO user_roles (user_id, role_id)
             VALUES ($1, $2)
             ON CONFLICT DO NOTHING
             RETURNING *`,
      [userId, roleId]
    );
    return mapRow(rows[0]);
  },

  /**
   * Assigne un rôle via son nom plutôt que son ID.
   * Évite de charger le rôle en mémoire avant de l'associer (une seule requête).
   */
  async assignRoleByName(userId, roleName, client = pgPool) {
    validateUUID(userId, 'userId');

    await client.query(
      `INSERT INTO user_roles (user_id, role_id)
             SELECT $1, id FROM roles WHERE name = $2
             ON CONFLICT DO NOTHING`,
      [userId, roleName]
    );
  },

  async removeUserRole(userId, roleId) {
    validateUUID(userId, 'userId');

    const { rowCount } = await pgPool.query(
      `DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2`,
      [userId, roleId]
    );
    return rowCount > 0;
  },

  /**
   * Retourne les rôles d'un utilisateur via jointure.
   * Utilisé par l'AuthService pour construire le payload JWT et vérifier les permissions.
   */
  async listUserRoles(userId) {
    validateUUID(userId, 'userId');

    const { rows } = await pgPool.query(
      `SELECT r.*
             FROM user_roles ur
             JOIN roles r ON r.id = ur.role_id
             WHERE ur.user_id = $1`,
      [userId]
    );
    return mapRows(rows);
  },
};