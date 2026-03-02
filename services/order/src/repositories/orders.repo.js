/**
 * @module Repository/Orders
 *
 * Gère le cycle de vie des commandes avec une séparation stricte
 * entre les commandes Guest (user_id IS NULL) et User (user_id IS NOT NULL).
 *
 * PRINCIPE DE SÉCURITÉ :
 * La colonne `user_id` est la source de vérité pour le périmètre d'accès.
 * - user_id IS NULL     → commande publique (accessible par suivi guest)
 * - user_id IS NOT NULL → commande privée (accessible uniquement par son propriétaire)
 *
 * Ce périmètre est appliqué directement en SQL, pas en application,
 * pour garantir l'immuabilité et éviter les oublis côté service.
 *
 * CROSS-SCHEMA :
 * Les JOINs sur `auth.users` et `product.product_variants` utilisent
 * le nom de schéma complet car le search_path de ce service est `"order"`.
 */
import { pgPool } from '../config/database.js';
import { mapRow, mapRows } from './_mappers.js';
import { validateUUID } from '../utils/validation.js';
import crypto from 'crypto';

// ─────────────────────────────────────────────────────────────────────
// FRAGMENT SQL RÉUTILISABLE — items enrichis avec l'image courante
// ─────────────────────────────────────────────────────────────────────

/**
 * Fragment json_build_object commun pour les agrégations d'items.
 *
 * L'image est lue directement depuis product.product_variants.attributes
 * pour garantir une URL valide indépendamment de ce qui était stocké
 * dans order_items.variant_attributes au moment du checkout.
 */
const ITEM_JSON_OBJECT = `
    json_build_object(
        'id',                oi.id,
        'variantId',         oi.variant_id,
        'productName',       oi.product_name,
        'variantAttributes', oi.variant_attributes,
        'unitPrice',         oi.unit_price,
        'quantity',          oi.quantity,
        'image',             pv.attributes->>'image'
    )
`;

export const ordersRepo = {

  // ─────────────────────────────────────────────────────────────────────
  // ÉCRITURE
  // ─────────────────────────────────────────────────────────────────────

  async createOrder(client, {
    userId,
    subtotalAmount,
    shippingCost,
    shippingMethod,
    taxAmount,
    taxRate,
    discountAmount,
    totalAmount,
    shippingAddress,
    billingAddress,
  }) {
    const { rows } = await client.query(
      `INSERT INTO orders
             (user_id, subtotal_amount, shipping_cost, shipping_method,
              tax_amount, tax_rate, discount_amount, total_amount,
              shipping_address, billing_address, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PENDING')
             RETURNING *`,
      [
        userId,
        subtotalAmount,
        shippingCost || 0,
        shippingMethod,
        taxAmount || 0,
        taxRate || 0,
        discountAmount || 0,
        totalAmount,
        shippingAddress,
        billingAddress,
      ]
    );
    return mapRow(rows[0]);
  },

  async addItem(client, {
    orderId,
    variantId,
    productName,
    variantAttributes,
    unitPrice,
    quantity,
  }) {
    const { rows } = await client.query(
      `INSERT INTO order_items
             (order_id, variant_id, product_name, variant_attributes, unit_price, quantity)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
      [orderId, variantId, productName, JSON.stringify(variantAttributes), unitPrice, quantity]
    );
    return mapRow(rows[0]);
  },

  // ─────────────────────────────────────────────────────────────────────
  // LECTURE — ACCÈS UNIVERSEL (authentifié ou admin)
  // ─────────────────────────────────────────────────────────────────────

  async findById(id) {
    validateUUID(id, 'orderId');
    const { rows } = await pgPool.query(
      `SELECT * FROM orders WHERE id = $1`,
      [id]
    );
    return mapRow(rows[0]);
  },

  // ─────────────────────────────────────────────────────────────────────
  // LECTURE — ACCÈS PUBLIC GUEST (barrière user_id IS NULL en SQL)
  // ─────────────────────────────────────────────────────────────────────

  async findGuestOnlyById(id) {
    validateUUID(id, 'orderId');

    const { rows } = await pgPool.query(
      `SELECT
               o.*,
               COALESCE(
                 json_agg(
                   ${ITEM_JSON_OBJECT}
                 ) FILTER (WHERE oi.id IS NOT NULL),
                 '[]'
               ) AS items
             FROM orders o
             LEFT JOIN order_items oi ON oi.order_id = o.id
             LEFT JOIN product.product_variants pv ON pv.id = oi.variant_id
             WHERE o.id = $1
               AND o.user_id IS NULL
             GROUP BY o.id`,
      [id]
    );

    return mapRow(rows[0]);
  },

  /**
   * Recherche guest par numéro + email — timing-safe.
   * La comparaison d'email est faite en application (après récupération)
   * pour garantir un temps de réponse constant et éviter les oracle timing.
   */
  async findByOrderNumberAndEmail(orderNumber, email) {
    const orderNumberRegex = /^ORD-\d{4}-\d+$/;
    if (!orderNumberRegex.test(orderNumber)) return null;

    const normalizedEmail = email.trim().toLowerCase();

    const { rows } = await pgPool.query(
      `SELECT
               o.*,
               COALESCE(
                 json_agg(
                   ${ITEM_JSON_OBJECT}
                 ) FILTER (WHERE oi.id IS NOT NULL),
                 '[]'
               ) AS items
             FROM orders o
             LEFT JOIN order_items oi ON oi.order_id = o.id
             LEFT JOIN product.product_variants pv ON pv.id = oi.variant_id
             WHERE o.order_number = $1
               AND o.user_id IS NULL
             GROUP BY o.id`,
      [orderNumber]
    );

    if (rows.length === 0) return null;

    const order = mapRow(rows[0]);
    const storedEmail = order.shippingAddress?.email?.trim().toLowerCase();
    if (!storedEmail) return null;

    try {
      const storedBuffer = Buffer.from(storedEmail, 'utf8');
      const providedBuffer = Buffer.from(normalizedEmail, 'utf8');
      const maxLength = Math.max(storedBuffer.length, providedBuffer.length);
      const paddedStored = Buffer.alloc(maxLength);
      const paddedProvided = Buffer.alloc(maxLength);

      storedBuffer.copy(paddedStored);
      providedBuffer.copy(paddedProvided);

      if (!crypto.timingSafeEqual(paddedStored, paddedProvided)) return null;
      return order;
    } catch {
      return null;
    }
  },

  async findGuestOrdersByEmail(email) {
    const normalizedEmail = email.trim().toLowerCase();
    const { rows } = await pgPool.query(
      `SELECT id, order_number
             FROM orders
             WHERE LOWER(shipping_address->>'email') = $1
               AND user_id IS NULL`,
      [normalizedEmail]
    );
    return rows;
  },

  // ─────────────────────────────────────────────────────────────────────
  // TRANSFERT — CLAIM (guest → user)
  // ─────────────────────────────────────────────────────────────────────

  async transferOwnership(orderId, newUserId, verificationEmail) {
    validateUUID(orderId, 'orderId');
    validateUUID(newUserId, 'newUserId');

    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');

      const { rows: orderRows } = await client.query(
        `SELECT * FROM orders WHERE id = $1 FOR UPDATE`,
        [orderId]
      );

      if (orderRows.length === 0) throw new Error('Commande introuvable');
      const order = mapRow(orderRows[0]);

      if (order.userId !== null) throw new Error('Déjà rattachée');

      const storedEmail = order.shippingAddress?.email?.trim().toLowerCase();
      if (storedEmail !== verificationEmail.trim().toLowerCase()) {
        throw new Error('Email incorrect');
      }

      const { rows: updatedRows } = await client.query(
        `UPDATE orders
                 SET user_id    = $1,
                     updated_at = NOW()
                 WHERE id = $2
                 RETURNING *`,
        [newUserId, orderId]
      );

      await client.query('COMMIT');
      return mapRow(updatedRows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  // ─────────────────────────────────────────────────────────────────────
  // LECTURE — ACCÈS PROPRIÉTAIRE AUTHENTIFIÉ
  // ─────────────────────────────────────────────────────────────────────

  async listByUserId(userId, { page = 1, limit = 10, status = null } = {}) {
    validateUUID(userId, 'userId');
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const parsedLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
    const offset = (parsedPage - 1) * parsedLimit;

    const values = [userId];
    let statusFilter = '';
    if (status) {
      values.push(status);
      statusFilter = `AND status = $${values.length}`;
    }

    // Compte total + données en parallèle pour éviter deux aller-retours séquentiels
    const [dataResult, countResult] = await Promise.all([
      pgPool.query(
        `SELECT
               o.*,
               COALESCE(
                 json_agg(
                   ${ITEM_JSON_OBJECT}
                 ) FILTER (WHERE oi.id IS NOT NULL),
                 '[]'
               ) AS items
             FROM orders o
             LEFT JOIN order_items oi ON oi.order_id = o.id
             LEFT JOIN product.product_variants pv ON pv.id = oi.variant_id
             WHERE o.user_id = $1 ${statusFilter}
             GROUP BY o.id
             ORDER BY o.created_at DESC
             LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, parsedLimit, offset]
      ),
      pgPool.query(
        `SELECT COUNT(*) FROM orders WHERE user_id = $1 ${statusFilter}`,
        values
      ),
    ]);

    const total = parseInt(countResult.rows[0].count, 10);

    return {
      orders: mapRows(dataResult.rows),
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total,
        totalPages: Math.ceil(total / parsedLimit) || 1,
      },
    };
  },

  /**
   * Retourne les items d'une commande enrichis de l'image courante de la variante.
   * Accepte un client optionnel pour s'exécuter dans une transaction externe.
   * Le schéma complet `product.product_variants` est requis car le search_path
   * de ce service est `"order"`.
   */
  async listItems(orderId, client = pgPool) {
    validateUUID(orderId, 'orderId');
    const { rows } = await client.query(
      `SELECT oi.*, pv.attributes->>'image' AS image
             FROM order_items oi
             LEFT JOIN product.product_variants pv ON pv.id = oi.variant_id
             WHERE oi.order_id = $1`,
      [orderId]
    );
    return mapRows(rows);
  },

  async updateStatus(orderId, status, paymentData = null, client = pgPool) {
    validateUUID(orderId, 'orderId');

    const { rows } = await client.query(
      `UPDATE orders SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [orderId, status]
    );
    const updatedOrder = mapRow(rows[0]);

    if (paymentData) {
      await client.query(
        `INSERT INTO payments (order_id, provider, payment_intent_id, status, amount)
                 VALUES ($1, $2, $3, $4, $5)`,
        [
          orderId,
          paymentData.provider,
          paymentData.paymentIntentId,
          'SUCCESS',
          paymentData.amount,
        ]
      );
    }

    return updatedOrder;
  },

  async getUserStats(userId) {
    validateUUID(userId, 'userId');
    const { rows } = await pgPool.query(
      `SELECT
               COUNT(*)::int                                                                       AS "totalOrders",
               COUNT(*) FILTER (WHERE status IN ('PENDING', 'PAID', 'PROCESSING', 'SHIPPED'))::int AS "pendingOrders",
               COALESCE(SUM(total_amount), 0)::numeric                                             AS "totalSpent"
             FROM orders
             WHERE user_id = $1`,
      [userId]
    );
    const row = rows[0];
    return {
      totalOrders: parseInt(row.totalOrders, 10),
      pendingOrders: parseInt(row.pendingOrders, 10),
      totalSpent: parseFloat(row.totalSpent),
    };
  },

  // ─────────────────────────────────────────────────────────────────────
  // ADMINISTRATION
  // ─────────────────────────────────────────────────────────────────────

  async findAll({ status, userId, search, page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;
    const values = [];
    let whereClause = 'WHERE 1=1';

    if (status && status !== 'ALL') {
      values.push(status);
      whereClause += ` AND o.status = $${values.length}`;
    }

    if (userId) {
      values.push(userId);
      whereClause += ` AND o.user_id = $${values.length}`;
    }

    if (search) {
      values.push(`%${search}%`);
      whereClause += ` AND (
                o.order_number ILIKE $${values.length} OR
                u.email ILIKE $${values.length} OR
                o.shipping_address->>'email' ILIKE $${values.length} OR
                o.shipping_address->>'lastName' ILIKE $${values.length}
            )`;
    }

    const countQuery = `
            SELECT COUNT(*)
            FROM orders o
            LEFT JOIN auth.users u ON o.user_id = u.id
            ${whereClause}
        `;
    const countValues = [...values];

    const query = `
            SELECT o.*, u.email AS user_email
            FROM orders o
            LEFT JOIN auth.users u ON o.user_id = u.id
            ${whereClause}
            ORDER BY o.created_at DESC
            LIMIT $${values.push(limit)} OFFSET $${values.push(offset)}
        `;

    const [dataResult, countResult] = await Promise.all([
      pgPool.query(query, values),
      pgPool.query(countQuery, countValues),
    ]);

    const total = parseInt(countResult.rows[0].count, 10);

    return {
      orders: mapRows(dataResult.rows),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  },

  async getGlobalStats(client = pgPool) {
    const { rows } = await client.query(
      `SELECT
               COUNT(*)                        AS count,
               COALESCE(SUM(total_amount), 0)  AS "totalAmount"
             FROM orders
             WHERE status != 'CANCELLED'`
    );
    return {
      count: parseInt(rows[0].count, 10),
      totalAmount: parseFloat(rows[0].totalAmount),
    };
  },

  async getDailySalesHistory(days = 30) {
    const { rows } = await pgPool.query(
      `SELECT
               DATE(created_at)               AS date,
               COALESCE(SUM(total_amount), 0) AS revenue
             FROM orders
             WHERE status NOT IN ('CANCELLED', 'PENDING')
               AND created_at >= NOW() - ($1 || ' days')::INTERVAL
             GROUP BY DATE(created_at)
             ORDER BY date ASC`,
      [days]
    );
    return rows;
  },
};