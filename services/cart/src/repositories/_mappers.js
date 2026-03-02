/**
 * @module Repository/Mappers
 *
 * Convertit les lignes SQL (snake_case) en objets JS (camelCase).
 */
const toCamel = (key) => key.replace(/_([a-z])/g, (_, char) => char.toUpperCase());

export const mapRow = (row) => {
    if (!row) return null;
    return Object.fromEntries(
        Object.entries(row).map(([key, value]) => [toCamel(key), value])
    );
};

export const mapRows = (rows) => rows.map(mapRow);
