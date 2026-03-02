/**
 * @module Repository/Index
 *
 * Point d'entrée unique de la couche repository.
 * Importer depuis ce fichier plutôt que depuis chaque repo individuel
 * permet de déplacer ou renommer un fichier sans impacter les services.
 */
export { usersRepo } from './users.repo.js';
export { rolesRepo } from './roles.repo.js';
export { refreshTokensRepo } from './refreshTokens.repo.js';