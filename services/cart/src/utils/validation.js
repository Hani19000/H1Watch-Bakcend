/**
 * @module Utils/Validation
 *
 * Validateurs centralisés du cart-service.
 */
import { ValidationError } from './appError.js';

export const validateRequired = (data, requiredFields) => {
    if (!data) throw new ValidationError('Aucune donnée fournie');
    const missing = requiredFields.filter(
        (f) => data[f] === undefined || data[f] === null || data[f] === ''
    );
    if (missing.length > 0) {
        throw new ValidationError(`Champs obligatoires manquants: ${missing.join(', ')}`);
    }
};

/** Vérifie le format UUID v4 */
export const validateUUID = (value, fieldName = 'ID') => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!value || !uuidRegex.test(value)) {
        throw new ValidationError(`${fieldName} doit être un UUID v4 valide`);
    }
};

/**
 * Valide qu'une quantité est un entier positif non nul.
 * Utilisé avant toute mutation sur le panier.
 */
export const validateQuantity = (value, fieldName = 'quantity') => {
    const parsed = parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new ValidationError(`${fieldName} doit être un entier positif`);
    }
    return parsed;
};

export const validateInteger = validateQuantity;
