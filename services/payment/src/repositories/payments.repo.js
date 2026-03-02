/**
 * @module Repository/Payments
 *
 * Gère la persistance des tentatives de paiement dans le schéma "payment".
 * Source de vérité pour la réconciliation avec Stripe.
 *
 * Chaque tentative de paiement est enregistrée indépendamment du statut
 * de la commande, pour permettre l'audit et le support client.
 */
import { pgPool } from '../config/database.js';
import { mapRow, mapRows } from './_mappers.js';

export const paymentsRepo = {

  /**
   * Enregistre une nouvelle tentative de paiement.
   * Appelé lors de la création d'une session Stripe Checkout.
   * Le statut initial est PENDING jusqu'à la réception du webhook.
   */
  async create({ orderId, provider = 'STRIPE', paymentIntentId, sessionId, amount, currency = 'EUR', metadata = {} }) {
    const { rows } = await pgPool.query(
      `INSERT INTO payments
             (order_id, provider, payment_intent_id, session_id, status, amount, currency, metadata)
             VALUES ($1, $2, $3, $4, 'PENDING', $5, $6, $7)
             RETURNING *`,
      [orderId, provider, paymentIntentId ?? null, sessionId ?? null, amount, currency, metadata]
    );

    return mapRow(rows[0]);
  },

  /**
   * Met à jour le statut d'un paiement identifié par son payment_intent_id.
   * Appelé lors du traitement d'un webhook Stripe (completed ou expired).
   * Retourne null si le payment_intent_id est introuvable (idempotence).
   */
  async updateStatusByIntentId(paymentIntentId, status) {
    const { rows } = await pgPool.query(
      `UPDATE payments
             SET status = $2, updated_at = NOW()
             WHERE payment_intent_id = $1
             RETURNING *`,
      [paymentIntentId, status]
    );

    return mapRow(rows[0] ?? null);
  },

  /**
   * Met à jour le payment_intent_id d'un paiement identifié par son session_id.
   * Stripe peut fournir le payment_intent après complétion alors qu'il était
   * absent lors de la création de la session.
   */
  async linkIntentToSession(sessionId, paymentIntentId) {
    const { rows } = await pgPool.query(
      `UPDATE payments
             SET payment_intent_id = $2, updated_at = NOW()
             WHERE session_id = $1
             RETURNING *`,
      [sessionId, paymentIntentId]
    );

    return mapRow(rows[0] ?? null);
  },

  /**
   * Retourne l'historique des paiements d'une commande.
   * Utile pour le support client (tentatives successives, erreurs).
   */
  async findByOrderId(orderId) {
    const { rows } = await pgPool.query(
      `SELECT * FROM payments
             WHERE order_id = $1
             ORDER BY created_at DESC`,
      [orderId]
    );

    return mapRows(rows);
  },

  /**
   * Retourne un paiement par son payment_intent_id Stripe.
   * Utilisé pour vérifier l'idempotence avant traitement d'un webhook.
   */
  async findByIntentId(paymentIntentId) {
    const { rows } = await pgPool.query(
      `SELECT * FROM payments
             WHERE payment_intent_id = $1`,
      [paymentIntentId]
    );

    return mapRow(rows[0] ?? null);
  },
};