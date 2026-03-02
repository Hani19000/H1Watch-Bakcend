/**
 * @module Routes/Inventory
 *
 * Routes publiques d'inventaire exposées par le Gateway sur /api/v1/inventory/*.
 *
 * Deux niveaux d'accès :
 *   - Lecture du stock d'une variante → public (utilisé par le frontend
 *     pour afficher "En stock / Rupture" sur la fiche produit)
 *   - Liste, alertes, ajustements → ADMIN uniquement
 *
 * La gestion d'inventaire depuis le dashboard admin transite par l'admin-service
 * via les routes /internal/admin/inventory (INTERNAL_ADMIN_SECRET).
 * Ces routes existent en parallèle pour un accès direct avec JWT Bearer.
 *
 * ORDRE DES ROUTES :
 *   /alerts déclaré avant /:variantId pour qu'Express ne l'interprète pas
 *   comme une valeur de paramètre.
 */
import { Router } from 'express';
import { inventoryController } from '../controllers/inventory.controller.js';
import { protect } from '../middleware/auth.middleware.js';
import { restrictTo } from '../middleware/role.middleware.js';

const router = Router();

// ── ADMINISTRATION ────────────────────────────────────────────────────────────
// Déclarées avant la route paramétrée /:variantId pour éviter les conflits.

// Liste complète de l'inventaire avec filtres et pagination
router.get('/', protect, restrictTo('ADMIN'), inventoryController.getAllInventory);

// Articles dont le stock est sous le seuil d'alerte
router.get('/alerts', protect, restrictTo('ADMIN'), inventoryController.getLowStockAlerts);

// ── LECTURE PUBLIQUE ──────────────────────────────────────────────────────────

// Stock disponible d'une variante — utilisé par le frontend pour les badges stock
router.get('/:variantId', inventoryController.getStock);

// ── MUTATIONS (admin uniquement) ──────────────────────────────────────────────

// Ajustement manuel : réception de marchandise, perte, correction d'inventaire
router.patch('/:variantId/adjust', protect, restrictTo('ADMIN'), inventoryController.adjustStock);

// Réapprovisionnement suite à une réception
router.patch('/restock/:variantId', protect, restrictTo('ADMIN'), inventoryController.addStock);

export default router;