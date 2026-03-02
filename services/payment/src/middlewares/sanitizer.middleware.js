/**
 * @module Middleware/Sanitizer
 *
 * Nettoie les entrées utilisateur avant qu'elles n'atteignent les services.
 * La sanitization ici est volontairement légère (trim + échappement HTML basique) :
 * elle couvre les cas XSS les plus courants sans dénaturer les données métier.
 * Pour des besoins avancés, envisager une bibliothèque dédiée (ex: DOMPurify, sanitize-html).
 */

/**
 * Échappe les caractères HTML dangereux pour neutraliser les injections de scripts.
 * On agit sur les strings uniquement — les types primitifs (number, boolean) sont renvoyés tels quels.
 */
const sanitizeValue = (value) => {
    if (typeof value === 'string') {
        return value.trim()
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }
    return value;
};

/**
 * Parcourt récursivement un objet pour sanitizer chaque valeur string.
 * La récursivité gère les payloads imbriqués (ex: adresse dans une commande).
 * Les champs mot de passe sont intentionnellement exclus pour préserver
 * les caractères spéciaux légitimes (ex: "<MonP4ssw0rd!>").
 */
const sanitizeObject = (obj) => {
    if (!obj) return obj;

    Object.keys(obj).forEach((key) => {
        const value = obj[key];

        if (key.toLowerCase().includes('password')) return;

        if (typeof value === 'object' && value !== null) {
            sanitizeObject(value);
        } else {
            obj[key] = sanitizeValue(value);
        }
    });
};

export const sanitizer = (req, _res, next) => {
    if (req.body) sanitizeObject(req.body);
    if (req.query) sanitizeObject(req.query);
    if (req.params) sanitizeObject(req.params);
    next();
};