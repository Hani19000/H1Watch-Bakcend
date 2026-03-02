/**
 * @module Repository/Mappers
 *
 * Convertit les lignes SQL (snake_case) en objets JS (camelCase).
 * Centraliser cette transformation ici évite de la dupliquer dans chaque repo
 * et garantit une convention de nommage uniforme dans toute la couche service.
 */

/**
 * Convertit une clé snake_case en camelCase.
 * Nécessaire car PostgreSQL utilise snake_case par convention.
 */
const toCamel = (key) => key.replace(/_([a-z])/g, (_, char) => char.toUpperCase());

/**
 * Mappe une ligne SQL unique vers un objet JS camelCase.
 * Retourne null si la ligne est absente (ex: query sans résultat).
 */
export const mapRow = (row) => {
  if (!row) return null;

  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [toCamel(key), value])
  );
};

/**
 * Mappe un tableau de lignes SQL vers des objets JS camelCase.
 */
export const mapRows = (rows) => rows.map(mapRow);