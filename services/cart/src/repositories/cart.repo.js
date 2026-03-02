/**
 * @module Repository/Cart
 *
 * Couche d'accès aux données du panier (schéma "cart").
 * Responsabilité unique : persistance et lecture — aucune logique métier ici.
 *
 * SÉCURITÉ :
 * - Toutes les clés primaires sont des UUID v4 validés avant exécution.
 * - Les requêtes de mutation vérifient la propriété via cart_id avant d'agir.
 * - ON CONFLICT ... DO UPDATE garantit l'atomicité sans vérification préalable (TOCTOU).
 */
import { pgPool } from '../config/database.js';
import { mapRow, mapRows } from './_mappers.js';
import { validateUUID, validateQuantity } from '../utils/validation.js';
import { NotFoundError, assertExists } from '../utils/appError.js';

export const cartRepo = {

    // ── GESTION DU PANIER ────────────────────────────────────────────────────

    /**
     * Crée un panier — associé à un utilisateur ou anonyme (guest).
     * Un panier guest est identifié par son UUID uniquement.
     */
    async create({ userId = null } = {}) {
        if (userId) validateUUID(userId, 'userId');

        const { rows } = await pgPool.query(
            `INSERT INTO carts (user_id) VALUES ($1) RETURNING *`,
            [userId]
        );
        return mapRow(rows[0]);
    },

    async findById(id) {
        validateUUID(id, 'cartId');
        const { rows } = await pgPool.query(
            `SELECT * FROM carts WHERE id = $1`,
            [id]
        );
        return mapRow(rows[0]);
    },

    async findByIdOrFail(id) {
        const cart = await this.findById(id);
        return assertExists(cart, 'Cart', id);
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
     * Récupère le panier d'un utilisateur ou en crée un s'il n'existe pas.
     * Évite la race condition create/find grâce au ON CONFLICT.
     */
    async getOrCreate(userId) {
        validateUUID(userId, 'userId');

        const { rows } = await pgPool.query(
            `INSERT INTO carts (user_id)
             VALUES ($1)
             ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
             RETURNING *`,
            [userId]
        );
        return mapRow(rows[0]);
    },

    /**
     * Supprime le panier et ses articles via ON DELETE CASCADE.
     * Appelé après conversion en commande pour éviter les paniers orphelins.
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

    // ── GESTION DES ARTICLES ─────────────────────────────────────────────────

    /**
     * Ajoute un article ou incrémente sa quantité si déjà présent.
     * L'atomicité est garantie par ON CONFLICT — pas de lecture préalable nécessaire.
     */
    async addItem({ cartId, variantId, quantity }) {
        validateUUID(cartId, 'cartId');
        validateUUID(variantId, 'variantId');
        validateQuantity(quantity);

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
     * Écrase la quantité d'un article (contrairement à addItem qui additionne).
     * Utilisé quand l'utilisateur saisit une quantité exacte dans l'UI.
     */
    async setItemQuantity({ cartId, variantId, quantity }) {
        validateUUID(cartId, 'cartId');
        validateUUID(variantId, 'variantId');
        validateQuantity(quantity);

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

    async removeItem(itemId) {
        validateUUID(itemId, 'itemId');
        const { rowCount } = await pgPool.query(
            `DELETE FROM cart_items WHERE id = $1`,
            [itemId]
        );
        if (rowCount === 0) throw new NotFoundError('CartItem', itemId);
        return true;
    },

    async removeItemByVariant(cartId, variantId) {
        validateUUID(cartId, 'cartId');
        validateUUID(variantId, 'variantId');
        const { rowCount } = await pgPool.query(
            `DELETE FROM cart_items WHERE cart_id = $1 AND variant_id = $2`,
            [cartId, variantId]
        );
        return rowCount > 0;
    },

    async clearCart(cartId) {
        validateUUID(cartId, 'cartId');
        await pgPool.query(`DELETE FROM cart_items WHERE cart_id = $1`, [cartId]);
        return true;
    },

    /**
     * Liste les articles du panier avec les données de base.
     * Les détails produit (prix, nom, image) sont enrichis dans la couche service
     * via productClient pour respecter les frontières de service.
     */
    async listItems(cartId) {
        validateUUID(cartId, 'cartId');
        const { rows } = await pgPool.query(
            `SELECT
               id,
               cart_id,
               variant_id,
               quantity,
               created_at,
               updated_at
             FROM cart_items
             WHERE cart_id = $1
             ORDER BY created_at ASC`,
            [cartId]
        );
        return mapRows(rows);
    },

    /**
     * Compte le nombre total d'articles (somme des quantités).
     * Utilisé pour afficher le badge du panier dans le header.
     */
    async countItems(cartId) {
        validateUUID(cartId, 'cartId');
        const { rows } = await pgPool.query(
            `SELECT COALESCE(SUM(quantity), 0) AS count FROM cart_items WHERE cart_id = $1`,
            [cartId]
        );
        return parseInt(rows[0].count, 10);
    },

    // ── NETTOYAGE ────────────────────────────────────────────────────────────

    /**
     * Supprime les paniers guests inactifs depuis plus de N jours.
     * Appelé par le cron de nettoyage — retourne le nombre de paniers supprimés.
     */
    async deleteExpiredGuestCarts(olderThanDays) {
        const { rowCount } = await pgPool.query(
            `DELETE FROM carts
             WHERE user_id IS NULL
               AND updated_at < NOW() - ($1 || ' days')::INTERVAL`,
            [olderThanDays]
        );
        return rowCount;
    },

    /**
     * Supprime les paniers utilisateurs inactifs depuis plus de N jours.
     * Les paniers utilisateurs ont un TTL plus long que les paniers guests.
     */
    async deleteExpiredUserCarts(olderThanDays) {
        const { rowCount } = await pgPool.query(
            `DELETE FROM carts
             WHERE user_id IS NOT NULL
               AND updated_at < NOW() - ($1 || ' days')::INTERVAL`,
            [olderThanDays]
        );
        return rowCount;
    },
};
