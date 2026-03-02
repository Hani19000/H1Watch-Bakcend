/**
 * @module Repository/Index
 *
 * Point d'entrée unique de la couche repository du payment-service.
 * Le payment-service possède uniquement la table `payment.payments`.
 * Les autres données (orders, users) sont accessibles via les clients HTTP.
 */
export { paymentsRepo } from './payments.repo.js';