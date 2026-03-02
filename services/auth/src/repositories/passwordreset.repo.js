/**
 * @module Repository/PasswordResetTokens
 *
 * Gère la persistance des tokens de réinitialisation de mot de passe.
 *
 * SÉCURITÉ :
 * - Le token brut n'est JAMAIS manipulé ici — seul le hash SHA-256 transite
 * - Requêtes paramétrées uniquement (protection SQL injection)
 */
import { pgPool } from '../config/database.js';
import { mapRow } from './_mappers.js';

export const passwordResetRepo = {
    /**
     * Supprime tout token existant pour cet utilisateur, puis insère le nouveau.
     * Garantit qu'un seul token actif existe par utilisateur à tout moment.
     *
     * @param {string} userId    - UUID de l'utilisateur
     * @param {string} tokenHash - Hash SHA-256 du token brut
     * @returns {Promise<Object>} Enregistrement créé
     */
    async createToken(userId, tokenHash) {
        const client = await pgPool.connect();
        try {
            await client.query('BEGIN');

            await client.query(
                `DELETE FROM password_reset_tokens WHERE user_id = $1`,
                [userId]
            );

            const { rows } = await client.query(
                `INSERT INTO password_reset_tokens (user_id, token_hash)
                 VALUES ($1, $2)
                 RETURNING *`,
                [userId, tokenHash]
            );

            await client.query('COMMIT');
            return mapRow(rows[0]);
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    },

    /**
     * Recherche un token valide (non expiré) par son hash.
     * Retourne null si le token est introuvable ou expiré.
     *
     * @param {string} tokenHash - Hash SHA-256 du token brut
     * @returns {Promise<Object|null>}
     */
    async findValidToken(tokenHash) {
        const { rows } = await pgPool.query(
            `SELECT * FROM password_reset_tokens
             WHERE token_hash = $1
               AND expires_at > NOW()`,
            [tokenHash]
        );
        return mapRow(rows[0]);
    },

    /**
     * Supprime le token après consommation (usage unique).
     *
     * @param {string} tokenHash - Hash SHA-256 du token brut
     * @returns {Promise<boolean>} true si un token a été supprimé
     */
    async deleteToken(tokenHash) {
        const { rowCount } = await pgPool.query(
            `DELETE FROM password_reset_tokens WHERE token_hash = $1`,
            [tokenHash]
        );
        return rowCount > 0;
    },
};