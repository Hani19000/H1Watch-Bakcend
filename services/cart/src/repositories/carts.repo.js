/**
 * @module Repository/Carts
 *
 * Gère la persistance du panier dans le schéma "cart".
 * Source de vérité pour les paniers utilisateurs.
 *
 * Ce repository ne connaît pas les données produit — l'enrichissement
 * (prix, nom, stock) est réalisé par le cart.service via le product-client.
 */
import { pgPool } from '../config/database.js';
import { mapRow, mapRows } from './_mappers.js';
import { validateUUID, validateQuantity } from '../utils/validation.js';
import { NotFoundError, assertExists } from '../utils/appError.js';

export const cartsRepo = {

    /**
     * Crée un nouveau panier vide pour un utilisateur.
     * La contrainte UNIQUE sur user_id empêche les doublons en base.
     */
    async create(userId) {
        validateUUID(userId, 'userId');

        const { rows } = await pgPool.query(
            `INSERT INTO carts (user_id) VALUES ($1) RETURNING *`,
            [userId]
        );

        return mapRow(rows[0]);
    },

    async findById(cartId) {
        validateUUID(cartId, 'cartId');

        const { rows } = await pgPool.query(
            `SELECT * FROM carts WHERE id = $1`,
            [cartId]
        );

        return mapRow(rows[0]);
    },

    async findByUserId(userId) {
        validateUUID(userId, 'userId');

        const { rows } = await pgPool.query(
            `SELECT * FROM carts WHERE user_id = $1`,
            [userId]
        );

        return mapRow(rows[0]);
    },

    /**
     * Récupère le panier existant ou en crée un nouveau.
     * Évite la double requête (find + create) dans le service.
     */
    async getOrCreate(userId) {
        validateUUID(userId, 'userId');

        const existing = await this.findByUserId(userId);
        return existing ?? await this.create(userId);
    },

    /**
     * Ajoute un article ou incrémente sa quantité si déjà présent.
     * ON CONFLICT garantit l'atomicité sans vérification préalable côté application.
     */
    async addItem({ cartId, variantId, quantity }) {
        validateUUID(cartId, 'cartId');
        validateUUID(variantId, 'variantId');
        validateQuantity(quantity, 'quantity');

        const { rows } = await pgPool.query(
            `INSERT INTO cart_items (cart_id, variant_id, quantity)
             VALUES ($1, $2, $3)
             ON CONFLICT (cart_id, variant_id)
             DO UPDATE SET
               quantity   = cart_items.quantity + EXCLUDED.quantity,
               updated_at = NOW()
             RETURNING *`,
            [cartId, variantId, quantity]
        );

        return mapRow(rows[0]);
    },

    /**
     * Écrase la quantité d'un article (l'utilisateur saisit une valeur exacte).
     * Contrairement à addItem qui additionne, setItemQuantity remplace.
     */
    async setItemQuantity({ cartId, variantId, quantity }) {
        validateUUID(cartId, 'cartId');
        validateUUID(variantId, 'variantId');
        validateQuantity(quantity, 'quantity');

        const { rows } = await pgPool.query(
            `INSERT INTO cart_items (cart_id, variant_id, quantity)
             VALUES ($1, $2, $3)
             ON CONFLICT (cart_id, variant_id)
             DO UPDATE SET
               quantity   = EXCLUDED.quantity,
               updated_at = NOW()
             RETURNING *`,
            [cartId, variantId, quantity]
        );

        return mapRow(rows[0]);
    },

    /**
     * Met à jour la quantité d'un article par son id primaire.
     * Utilisé par updateItemQuantity du service qui résout l'id depuis le cartId.
     */
    async updateItemQuantityById(itemId, quantity) {
        validateQuantity(quantity, 'quantity');

        const { rows } = await pgPool.query(
            `UPDATE cart_items SET quantity = $2, updated_at = NOW()
             WHERE id = $1 RETURNING *`,
            [itemId, quantity]
        );

        return assertExists(mapRow(rows[0]), 'CartItem', itemId);
    },

    async removeItem(itemId) {
        const { rowCount } = await pgPool.query(
            `DELETE FROM cart_items WHERE id = $1`,
            [itemId]
        );

        if (rowCount === 0) throw new NotFoundError('CartItem', itemId);
        return true;
    },

    /**
     * Vide le panier sans le supprimer.
     * Appelé depuis clearCart du service (après checkout, par exemple).
     */
    async clearItems(cartId) {
        validateUUID(cartId, 'cartId');

        await pgPool.query(`DELETE FROM cart_items WHERE cart_id = $1`, [cartId]);
        return true;
    },

    /**
     * Retourne les articles bruts (variant_id + quantity uniquement).
     * L'enrichissement produit est réalisé par le service via HTTP.
     */
    async listRawItems(cartId) {
        validateUUID(cartId, 'cartId');

        const { rows } = await pgPool.query(
            `SELECT id, cart_id, variant_id, quantity, created_at, updated_at
             FROM cart_items
             WHERE cart_id = $1
             ORDER BY created_at ASC`,
            [cartId]
        );

        return mapRows(rows);
    },

    async countItems(cartId) {
        validateUUID(cartId, 'cartId');

        const { rows } = await pgPool.query(
            `SELECT COALESCE(SUM(quantity), 0) AS count FROM cart_items WHERE cart_id = $1`,
            [cartId]
        );

        return parseInt(rows[0].count, 10);
    },

    /**
     * Supprime définitivement le panier et ses articles (CASCADE).
     * Appelé après fusion du panier guest dans le panier utilisateur.
     */
    async delete(cartId) {
        validateUUID(cartId, 'cartId');

        const { rowCount } = await pgPool.query(
            `DELETE FROM carts WHERE id = $1`,
            [cartId]
        );

        if (rowCount === 0) throw new NotFoundError('Cart', cartId);
        return true;
    },
};
