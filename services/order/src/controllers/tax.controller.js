/**
 * @module Controller/Tax
 * @service order-service
 *
 * Expose les calculs fiscaux de taxService via HTTP.
 *
 * APPARTENANCE — Pourquoi dans l'order-service :
 *   Le calcul de la TVA fait partie intégrante du calcul d'un total de commande.
 *   taxService est déjà utilisé en interne par ordersService#_calculateTotals.
 *   Exposer ses méthodes ici évite la duplication de logique et garde la
 *   séparation des responsabilités : l'order-service est le garant des calculs
 *   financiers liés aux commandes (prix, taxes, frais de port).
 *
 * SÉCURITÉ — Routes publiques :
 *   Les taux de TVA sont des données publiques (consulter le site officiel
 *   de chaque pays donne le même résultat). Aucune donnée sensible n'est
 *   exposée. L'authentification n'est donc pas requise sur ces endpoints.
 *   Le rate limiter général (generalLimiter) s'applique via index.routes.js.
 */
import { taxService } from '../services/tax.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { AppError } from '../utils/appError.js';

class TaxController {
    /**
     * GET /api/v1/taxes/rates/:country
     * Retourne les taux de TVA disponibles pour un pays donné.
     * Utilisé par le frontend au chargement de la page checkout
     * pour afficher le détail des taxes.
     *
     * @example GET /api/v1/taxes/rates/France
     * → { country: "France", rates: { standard: 20, reduced: 5.5, intermediate: 10 } }
     */
    getCountryRates = asyncHandler(async (req, res) => {
        const { country } = req.params;

        // Le service retourne le taux DEFAULT si le pays est inconnu —
        // pas d'erreur levée, le frontend affiche simplement le taux standard.
        const rates = taxService.getCountryRates(country);

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: { country, rates },
        });
    });

    /**
     * GET /api/v1/taxes/calculate?amount=100&country=France&category=standard
     * Calcule la TVA pour un montant HT donné.
     * Utile pour les previews dynamiques dans le panier.
     */
    calculate = asyncHandler(async (req, res) => {
        const { amount, country = 'France', category = 'standard' } = req.query;

        if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
            throw new AppError('Le paramètre amount doit être un nombre positif', HTTP_STATUS.BAD_REQUEST);
        }

        const result = taxService.calculateTax(parseFloat(amount), country, category);

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: result,
        });
    });

    /**
     * GET /api/v1/taxes/countries
     * Liste tous les pays supportés avec leurs taux de TVA.
     * Utilisé par les sélecteurs de pays dans le checkout.
     */
    getAllCountries = asyncHandler(async (_req, res) => {
        const countries = taxService.getAllSupportedCountries();

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            results: countries.length,
            data: { countries },
        });
    });

    /**
     * POST /api/v1/taxes/check-exemption
     * Vérifie l'éligibilité à l'exonération de TVA (ventes B2B intracommunautaires).
     * Le numéro de TVA est masqué dans la réponse pour éviter son exposition dans les logs.
     */
    checkExemption = asyncHandler(async (req, res) => {
        const { country, vatNumber } = req.body;

        if (!country) {
            throw new AppError('Le champ country est requis', HTTP_STATUS.BAD_REQUEST);
        }

        const isExempt = taxService.isEligibleForExemption(country, vatNumber);

        res.status(HTTP_STATUS.OK).json({
            status: 'success',
            data: {
                isExempt,
                country,
                // Masquage partiel pour éviter l'exposition du numéro complet dans les logs
                vatNumber: vatNumber ? '***' + vatNumber.slice(-4) : null,
            },
        });
    });
}

export const taxController = new TaxController();
