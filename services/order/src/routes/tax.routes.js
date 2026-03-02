/**
 * @module Routes/Tax
 * @service order-service
 *
 * Endpoints de consultation des taux de TVA et calculs fiscaux.
 *
 * Toutes ces routes sont PUBLIQUES :
 *   - Les taux de TVA sont des données réglementaires accessibles publiquement.
 *   - Les guests ont besoin de voir les taxes avant de créer un compte.
 *   - Le rate limiter général (appliqué dans index.routes.js) protège contre
 *     les abus sans bloquer les usages légitimes.
 */
import { Router } from 'express';
import { taxController } from '../controllers/tax.controller.js';

const router = Router();

// Taux de TVA pour un pays donné (appel principal du frontend au checkout)
router.get('/rates/:country', taxController.getCountryRates);

// Calcul de TVA pour un montant donné (preview dynamique panier)
router.get('/calculate', taxController.calculate);

// Liste de tous les pays supportés (sélecteur de pays au checkout)
router.get('/countries', taxController.getAllCountries);

// Vérification d'exonération TVA B2B intracommunautaire
router.post('/check-exemption', taxController.checkExemption);

export default router;
