/**
 * @module Service/Tax
 *
 * Gère le calcul des taxes selon les règles fiscales par pays/région.
 * Centralisé pour faciliter les mises à jour réglementaires sans toucher à la logique métier.
 */
import { ValidationError } from '../utils/appError.js';

class TaxService {
    // Taux de TVA par pays — centralisés ici pour faciliter les ajustements législatifs.
    #taxRates = {
        France: {
            standard: 20.0,
            reduced: 5.5,       // Livres, alimentation de base
            intermediate: 10.0, // Restauration, transport
        },
        Belgium: {
            standard: 21.0,
            reduced: 6.0,
            intermediate: 12.0,
        },
        Germany: {
            standard: 19.0,
            reduced: 7.0,
        },
        Spain: {
            standard: 21.0,
            reduced: 10.0,
            superReduced: 4.0,
        },
        Italy: {
            standard: 22.0,
            reduced: 10.0,
            superReduced: 5.0,
        },
        Switzerland: {
            standard: 7.7,
            reduced: 2.5,
        },
        DEFAULT: {
            standard: 20.0,
        },
    };

    constructor() {
        if (TaxService.instance) return TaxService.instance;
        TaxService.instance = this;
        Object.freeze(this);
    }

    /**
     * Retourne tous les taux disponibles pour un pays.
     * Utilisé par le frontend pour afficher les options de taxation et pour les calculs internes.
     */
    getCountryRates(country) {
        return this.#taxRates[country] || this.#taxRates.DEFAULT;
    }

    /**
     * Calcule la TVA applicable selon le pays de livraison.
     * Pour l'UE : applique le taux du pays de destination (règle post-Brexit).
     */
    calculateTax(subtotal, country, taxCategory = 'standard') {
        if (subtotal <= 0) throw new ValidationError('Montant invalide');

        const countryRates = this.getCountryRates(country);
        const rate = countryRates[taxCategory] || countryRates.standard;
        const taxAmount = (subtotal * rate) / 100;

        return {
            taxAmount: Math.round(taxAmount * 100) / 100,
            taxRate: rate,
            taxCategory,
            country,
        };
    }

    /**
     * Décompose un montant TTC en HT + TVA.
     * Utile pour les rapports comptables et déclarations fiscales.
     */
    extractTaxFromTotal(totalIncludingTax, country, taxCategory = 'standard') {
        const countryRates = this.#taxRates[country] || this.#taxRates.DEFAULT;
        const rate = countryRates[taxCategory] || countryRates.standard;

        const subtotal = totalIncludingTax / (1 + rate / 100);
        const taxAmount = totalIncludingTax - subtotal;

        return {
            subtotal: Math.round(subtotal * 100) / 100,
            taxAmount: Math.round(taxAmount * 100) / 100,
            taxRate: rate,
        };
    }

    /**
     * Détermine si un pays est éligible à l'exonération de TVA.
     * Ex : ventes B2B intracommunautaires avec numéro de TVA valide.
     */
    isEligibleForExemption(country, vatNumber = null) {
        const euCountries = [
            'France', 'Germany', 'Spain', 'Italy', 'Belgium',
            'Netherlands', 'Portugal', 'Austria', 'Sweden',
        ];

        // Exemption si vente B2B intra-UE avec numéro de TVA valide.
        // TODO: Intégrer validation API VIES (EU VAT validation).
        if (euCountries.includes(country) && vatNumber) {
            return true;
        }

        return false;
    }

    /**
     * Liste tous les pays supportés avec leurs taux.
     * Utile pour les dashboards admin.
     */
    getAllSupportedCountries() {
        return Object.keys(this.#taxRates)
            .filter((key) => key !== 'DEFAULT')
            .map((country) => ({
                country,
                rates: this.#taxRates[country],
            }));
    }
}

export const taxService = new TaxService();