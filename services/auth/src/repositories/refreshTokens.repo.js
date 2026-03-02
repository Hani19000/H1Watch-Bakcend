/**
 * @module Repository/RefreshTokens
 *
 * Gère la persistance des jetons de rafraîchissement JWT.
 * Chaque connexion génère un jeton stocké en base pour permettre
 * la révocation individuelle (logout d'un appareil) ou globale (compromission de compte).
 */
import { pgPool } from '../config/database.js';
import { mapRow } from './_mappers.js';

export const refreshTokensRepo = {
  async create({ userId, token, expiresAt }) {
    const { rows } = await pgPool.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
             VALUES ($1, $2, $3)
             RETURNING *`,
      [userId, token, expiresAt]
    );

    return mapRow(rows[0]);
  },

  /**
   * Recherche un jeton pour valider une demande de refresh.
   * Le service doit vérifier expires_at après cet appel
   * car la requête ne filtre pas sur la date d'expiration.
   */
  async findByToken(token) {
    const { rows } = await pgPool.query(
      `SELECT * FROM refresh_tokens WHERE token = $1`,
      [token]
    );

    return mapRow(rows[0]);
  },

  /**
   * Révoque un jeton spécifique (déconnexion d'un seul appareil).
   */
  async revokeById(id) {
    const { rowCount } = await pgPool.query(
      `DELETE FROM refresh_tokens WHERE id = $1`,
      [id]
    );

    return rowCount > 0;
  },

  /**
   * Révoque tous les jetons d'un utilisateur.
   * Utilisé en cas de changement de mot de passe ou de suspicion de compromission.
   */
  async revokeByUserId(userId) {
    const { rowCount } = await pgPool.query(
      `DELETE FROM refresh_tokens WHERE user_id = $1`,
      [userId]
    );

    return rowCount > 0;
  },

  /**
   * Supprime les jetons expirés pour éviter une croissance illimitée de la table.
   * Destiné à être appelé par un cron job périodique.
   * Retourne le nombre de jetons supprimés pour le monitoring.
   */
  async deleteExpired() {
    const { rowCount } = await pgPool.query(
      `DELETE FROM refresh_tokens WHERE expires_at < NOW()`
    );

    return rowCount;
  },
};