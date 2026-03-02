/**
 * @module Routes/Cart
 *
 * Routes du panier — entièrement protégées par JWT.
 * La validation des paramètres d'entrée est réalisée en middleware inline
 * pour fail-fast avant d'atteindre le contrôleur.
 */
import { Router } from 'express';
import { cartController } from '../controllers/cart.controller.js';
import { protect } from '../middlewares/auth.middleware.js';
import { validateUUID, validateQuantity } from '../utils/validation.js';

const router = Router();

// Toutes les routes du panier nécessitent une authentification
router.use(protect);

router.get('/', cartController.getCart);

router.post(
    '/items',
    (req, _res, next) => {
        validateUUID(req.body.variantId, 'variantId');
        validateQuantity(req.body.quantity, 'quantity');
        next();
    },
    cartController.addItem
);

router.patch(
    '/items/:itemId',
    (req, _res, next) => {
        validateQuantity(req.body.quantity, 'quantity');
        next();
    },
    cartController.updateQuantity
);

router.delete('/items/:itemId', cartController.removeItem);

router.delete('/', cartController.clear);

export default router;
