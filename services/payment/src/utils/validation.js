/**
 * @module Utils/Validation
 *
 * Validateurs centralisés du payment-service.
 * Centraliser ici garantit des messages d'erreur cohérents dans toute l'application.
 */
import { ValidationError } from './appError.js';

/** Lance une erreur si un des champs requis est absent du payload */
export const validateRequired = (data, requiredFields) => {
    if (!data) throw new ValidationError('Aucune donnée fournie');
    const missing = requiredFields.filter((f) => data[f] === undefined || data[f] === null || data[f] === '');
    if (missing.length > 0) {
        throw new ValidationError(`Champs obligatoires manquants: ${missing.join(', ')}`);
    }
};

/** Vérifie le format UUID v4 — utilisé pour valider les paramètres d'URL */
export const validateUUID = (value, fieldName = 'ID') => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!value || !uuidRegex.test(value)) {
        throw new ValidationError(`${fieldName} doit être un UUID v4 valide`);
    }
};

/** Format email selon RFC 5322 simplifié */
export const validateEmail = (email) => {
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/;
    if (!email || !emailRegex.test(email)) {
        throw new ValidationError('Format email invalide');
    }
};