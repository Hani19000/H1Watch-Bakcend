/**
 * @module Jobs/CartCleanup
 *
 * Nettoyage planifié des paniers abandonnés.
 *
 * POURQUOI :
 * Les paniers guests et les paniers utilisateurs inactifs s'accumulent en base.
 * Ce cron évite la croissance indéfinie de la table cart_items.
 *
 * FRÉQUENCE :
 * Quotidienne à 2h00 — heure creuse pour minimiser l'impact sur les performances.
 */
import { cartRepo } from '../repositories/index.js';
import { ENV } from '../config/environment.js';
import { logInfo, logError } from '../utils/logger.js';

export const cartCleanupJob = {
    name: 'cart-cleanup',
    // Tous les jours à 2h00 UTC
    schedule: '0 2 * * *',

    async execute() {
        try {
            const [deletedGuest, deletedUser] = await Promise.all([
                cartRepo.deleteExpiredGuestCarts(ENV.cart.guestExpirationDays),
                cartRepo.deleteExpiredUserCarts(ENV.cart.userExpirationDays),
            ]);

            logInfo(
                `[CRON] Nettoyage paniers : ${deletedGuest} guest supprimés (>${ENV.cart.guestExpirationDays}j), ` +
                `${deletedUser} utilisateurs supprimés (>${ENV.cart.userExpirationDays}j)`
            );
        } catch (error) {
            logError(error, { context: 'cartCleanupJob.execute' });
        }
    },
};
