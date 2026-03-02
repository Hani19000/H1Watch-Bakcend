/**
 * @module Repository/Index
 *
 * Point d'entrée unique de la couche repository de l'order-service.
 *
 * L'order-service possède uniquement les tables `order.orders`,
 * `order.order_items` et `order.shipments`. Les autres données
 * (inventory, products, users) sont accessibles via les clients HTTP.
 */
export { ordersRepo } from './orders.repo.js';
export { shipmentsRepo } from './shipments.repo.js';