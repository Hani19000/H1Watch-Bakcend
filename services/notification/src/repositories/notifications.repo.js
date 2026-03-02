/**
 * @module Repository/Notifications
 *
 * Gère la persistance des logs de notification dans le schéma "notification".
 *
 * Stratégie d'écriture du worker :
 *   - Job réussi     → INSERT avec status SENT et sent_at = NOW()
 *   - Échec définitif → INSERT avec status FAILED et error_message
 *
 * L'index UNIQUE sur job_id garantit l'idempotence :
 * si le worker crashe et retraite un job déjà loggé, l'upsert
 * met à jour l'entrée existante plutôt que d'en créer un doublon.
 */
import { pgPool } from '../config/database.js';
import { mapRow, mapRows } from './_mappers.js';

export const notificationsRepo = {

    /**
     * Persiste un log après envoi réussi.
     * Utilise ON CONFLICT pour l'idempotence en cas de double exécution du worker.
     */
    async logSuccess({ jobId, type, recipientEmail, attempts }) {
        const { rows } = await pgPool.query(
            `INSERT INTO notification_logs
                (job_id, type, recipient_email, status, attempts, sent_at)
             VALUES ($1, $2, $3, 'SENT', $4, NOW())
             ON CONFLICT (job_id) DO UPDATE
                SET status        = 'SENT',
                    attempts      = EXCLUDED.attempts,
                    sent_at       = NOW(),
                    error_message = NULL,
                    updated_at    = NOW()
             RETURNING *`,
            [jobId, type, recipientEmail, attempts]
        );
        return mapRow(rows[0]);
    },

    /**
     * Persiste un log après échec définitif (toutes les tentatives épuisées).
     * Utilise ON CONFLICT pour l'idempotence en cas de double exécution du worker.
     */
    async logFailure({ jobId, type, recipientEmail, attempts, errorMessage }) {
        const { rows } = await pgPool.query(
            `INSERT INTO notification_logs
                (job_id, type, recipient_email, status, attempts, error_message)
             VALUES ($1, $2, $3, 'FAILED', $4, $5)
             ON CONFLICT (job_id) DO UPDATE
                SET status        = 'FAILED',
                    attempts      = EXCLUDED.attempts,
                    error_message = EXCLUDED.error_message,
                    updated_at    = NOW()
             RETURNING *`,
            [jobId, type, recipientEmail, attempts, errorMessage ?? null]
        );
        return mapRow(rows[0]);
    },

    /**
     * Historique des notifications d'un destinataire.
     * Utilisé par le support client pour vérifier les envois passés.
     *
     * @param {string} email
     * @param {{ limit?: number, offset?: number }} options
     */
    async findByRecipient(email, { limit = 20, offset = 0 } = {}) {
        const { rows } = await pgPool.query(
            `SELECT * FROM notification_logs
             WHERE recipient_email = $1
             ORDER BY created_at DESC
             LIMIT $2 OFFSET $3`,
            [email, limit, offset]
        );
        return mapRows(rows);
    },

    /**
     * Logs filtrés par statut et/ou type pour le dashboard admin.
     * Retourne les N entrées les plus récentes.
     *
     * @param {{ status?: string, type?: string, limit?: number, offset?: number }} filters
     */
    async findByFilters({ status, type, limit = 50, offset = 0 } = {}) {
        const conditions = [];
        const params = [];

        if (status) {
            params.push(status);
            conditions.push(`status = $${params.length}`);
        }

        if (type) {
            params.push(type);
            conditions.push(`type = $${params.length}`);
        }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        params.push(limit, offset);
        const { rows } = await pgPool.query(
            `SELECT * FROM notification_logs
             ${where}
             ORDER BY created_at DESC
             LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params
        );
        return mapRows(rows);
    },
};
