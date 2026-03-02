/**
 * @module Repository/Users
 *
 * Gère la persistance des utilisateurs et de leurs données sensibles.
 */
import { pgPool } from '../config/database.js';
import { mapRow, mapRows } from './_mappers.js';
import { validateUUID } from '../utils/validation.js';

export const usersRepo = {
  /**
   * Crée un utilisateur en normalisant l'email en minuscules dès la persistance.
   * Centraliser cette normalisation en base plutôt que dans le service évite
   * les doublons causés par des casses différentes (ex : "User@mail.com" vs "user@mail.com").
   * Accepte un client de transaction pour s'intégrer dans un flux de création atomique
   * (ex : création utilisateur + attribution du rôle par défaut).
   */
  async create({ email, passwordHash, salt, firstName, lastName, phone }, client = pgPool) {
    const { rows } = await client.query(
      `INSERT INTO users (email, password_hash, salt, first_name, last_name, phone)
             VALUES (LOWER($1), $2, $3, $4, $5, $6)
             RETURNING *`,
      [email, passwordHash, salt, firstName ?? null, lastName ?? null, phone ?? null]
    );

    return mapRow(rows[0]);
  },

  async findById(id) {
    validateUUID(id, 'userId');

    const { rows } = await pgPool.query(
      `SELECT * FROM users WHERE id = $1`,
      [id]
    );

    return mapRow(rows[0]);
  },

  async findByEmail(email) {
    const { rows } = await pgPool.query(
      `SELECT * FROM users WHERE LOWER(email) = LOWER($1)`,
      [email]
    );

    return mapRow(rows[0]);
  },

  /**
   * Liste les utilisateurs en excluant les champs sensibles (password_hash, salt).
   * Une projection explicite ici plutôt qu'un SELECT * protège contre
   * une fuite accidentelle de credentials si la réponse est sérialisée telle quelle.
   */
  async list(params = {}) {
    const { search, limit = 10, page = 1 } = params;
    const offset = (page - 1) * limit;

    let query = `
      SELECT id, email, first_name, last_name, phone, is_active, created_at
      FROM users
      WHERE 1=1
    `;
    const values = [];

    if (search) {
      values.push(`%${search}%`);
      query += ` AND (
        first_name ILIKE $${values.length} OR
        last_name ILIKE $${values.length} OR
        email ILIKE $${values.length}
      )`;
    }

    const countQuery = `SELECT COUNT(*) as total FROM (${query}) as subquery`;
    const countResult = await pgPool.query(countQuery, values);
    const total = parseInt(countResult.rows[0].total, 10);

    query += ` ORDER BY created_at DESC`;

    values.push(limit);
    query += ` LIMIT $${values.length}`;

    values.push(offset);
    query += ` OFFSET $${values.length}`;

    const { rows } = await pgPool.query(query, values);

    return {
      users: mapRows(rows),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  /**
   * Retourne uniquement les champs nécessaires à l'authentification.
   * Limiter la surface de données exposée réduit le risque en cas de log ou de fuite mémoire.
   */
  async findByEmailWithCredentials(email) {
    const { rows } = await pgPool.query(
      `SELECT id, email, first_name, password_hash, salt, is_active
             FROM users
             WHERE LOWER(email) = LOWER($1)`,
      [email]
    );

    return mapRow(rows[0]);
  },

  async updateProfile(id, { firstName, lastName, phone }) {
    validateUUID(id, 'userId');

    const { rows } = await pgPool.query(
      `UPDATE users
             SET first_name = $2,
                 last_name  = $3,
                 phone      = $4,
                 updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
      [id, firstName ?? null, lastName ?? null, phone ?? null]
    );

    return mapRow(rows[0]);
  },

  async setActive(id, isActive) {
    validateUUID(id, 'userId');

    const { rows } = await pgPool.query(
      `UPDATE users SET is_active = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, isActive]
    );

    return mapRow(rows[0]);
  },

  async deleteById(id) {
    validateUUID(id, 'userId');

    const { rowCount } = await pgPool.query(
      `DELETE FROM users WHERE id = $1`,
      [id]
    );

    return rowCount > 0;
  },

  /**
   * Met à jour les credentials après un changement de mot de passe.
   * Retourne un booléen plutôt que l'utilisateur complet pour ne pas exposer
   * les nouveaux hash/salt dans les logs du service appelant.
   */
  async updateCredentials(userId, { passwordHash, salt }) {
    validateUUID(userId, 'userId');

    const { rows } = await pgPool.query(
      `UPDATE users
             SET password_hash = $2,
                 salt          = $3,
                 updated_at    = NOW()
             WHERE id = $1
             RETURNING id`,
      [userId, passwordHash, salt]
    );

    return rows.length > 0;
  },

  /**
   * Compte le nombre total d'utilisateurs.
   * Nécessaire pour le tableau de bord administrateur.
   */
  async count() {
    const { rows } = await pgPool.query('SELECT COUNT(*) FROM users');
    return parseInt(rows[0].count, 10);
  },

  async getPasswordHistory(userId, limit = 5) {
    validateUUID(userId, 'userId');

    const { rows } = await pgPool.query(
      `SELECT password_hash, salt
       FROM password_history
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );

    return mapRows(rows);
  },

  /**
   * Ajoute un ancien hash et son salt dans la table d'historique.
   * Permet de détecter la réutilisation d'un mot de passe précédent.
   */
  async addToHistory(userId, passwordHash, salt) {
    validateUUID(userId, 'userId');

    const { rows } = await pgPool.query(
      `INSERT INTO password_history (user_id, password_hash, salt)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [userId, passwordHash, salt]
    );

    return rows.length > 0;
  },
};