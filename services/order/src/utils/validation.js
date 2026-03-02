/**
 * @module Utils/Validation
 *
 * Bibliothèque de validateurs centralisée.
 * Regrouper les validations ici évite la duplication dans les services
 * et garantit des messages d'erreur cohérents dans toute l'application.
 */
import { ValidationError } from './appError.js';

// --- 1. Validateurs Génériques ---

/** Retourne false si la valeur est absente ou vide */
export const isDefined = (value) => {
    return value !== undefined && value !== null && value !== '';
};

/** Lance une erreur si un des champs requis est absent du payload */
export const validateRequired = (data, requiredFields) => {
    if (!data) throw new ValidationError('Aucune donnée fournie');
    const missingFields = requiredFields.filter((field) => !isDefined(data[field]));
    if (missingFields.length > 0) {
        throw new ValidationError(`Champs obligatoires manquants: ${missingFields.join(', ')}`);
    }
};

/** Vérifie le format UUID v4 — utilisé pour valider les paramètres d'URL */
export const validateUUID = (value, fieldName = 'ID') => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!value || !uuidRegex.test(value)) {
        throw new ValidationError(`${fieldName} doit être un UUID v4 valide`);
    }
};

/**
 * Valide qu'une valeur appartient à un tableau de valeurs autorisées.
 * Pour valider contre un enum PostgreSQL, préférer `assertValidEnum` de constants/enums.js.
 */
export const validateEnum = (value, allowedValues, fieldName = 'Field') => {
    if (!allowedValues.includes(value)) {
        throw new ValidationError(
            `${fieldName} invalide. Valeurs autorisées: ${allowedValues.join(', ')}`
        );
    }
};

// --- 2. Validateurs E-commerce & Maths ---

/** Rejette les quantités négatives ou décimales qui créeraient des incohérences en stock */
export const validateInteger = (number, fieldName = 'Quantity') => {
    if (!Number.isInteger(number) || number < 0) {
        throw new ValidationError(`${fieldName} doit être un entier positif`);
    }
};

/** Alias sémantique de validateInteger pour les contextes métier liés aux stocks */
export const validateQuantity = validateInteger;

/** Rejette les montants invalides pour éviter des erreurs silencieuses en comptabilité */
export const validateAmount = (amount, fieldName = 'Amount') => {
    if (typeof amount !== 'number' || isNaN(amount) || amount < 0) {
        throw new ValidationError(`${fieldName} doit être un nombre positif`);
    }
};

/** Valide les taux de remise ou TVA qui ne peuvent excéder 100% */
export const validatePercentage = (value, fieldName = 'Percentage') => {
    if (typeof value !== 'number' || value < 0 || value > 100) {
        throw new ValidationError(`${fieldName} doit être compris entre 0 et 100`);
    }
};

// --- 3. Validateurs Utilisateur & Auth ---

/** Format email selon RFC 5322 simplifié */
export const validateEmail = (email) => {
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/;
    if (!email || !emailRegex.test(email)) {
        throw new ValidationError('Format email invalide');
    }
};

/** Exige un minimum de complexité pour réduire les risques de compromission de compte */
export const validatePasswordStrength = (password) => {
    if (!password || password.length < 8) {
        throw new ValidationError('Le mot de passe doit contenir au moins 8 caractères');
    }
    const strongRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d\w\W]{8,}$/;
    if (!strongRegex.test(password)) {
        throw new ValidationError('Le mot de passe doit contenir une majuscule et un chiffre');
    }
};

/** Valide le format du numéro de téléphone. Optionnel : ignoré si la valeur est absente. */
export const validatePhone = (phone) => {
    const phoneRegex = /^\+?[0-9\s-]{8,15}$/;
    if (phone && !phoneRegex.test(phone)) {
        throw new ValidationError('Format de téléphone invalide');
    }
};

// --- 4. Validateurs Produit & Contenu ---

/** Le SKU doit être lisible en entrepôt — pas d'espaces ni de caractères spéciaux */
export const validateSKU = (sku) => {
    const skuRegex = /^[A-Z0-9-_]{3,30}$/;
    if (!sku || !skuRegex.test(sku)) {
        throw new ValidationError('Le SKU doit être alphanumérique (A-Z, 0-9) et sans espaces');
    }
};

/** Le slug est utilisé dans les URLs — les espaces ou majuscules casseraient le SEO */
export const validateSlug = (slug) => {
    const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    if (!slug || !slugRegex.test(slug)) {
        throw new ValidationError('Le slug doit être en minuscules avec des tirets');
    }
};

export const validateAddress = (address) => {
    if (!address || typeof address !== 'object') {
        throw new ValidationError('Adresse invalide ou manquante');
    }
    validateRequired(address, ['street', 'city', 'country', 'postalCode']);
    if (address.postalCode.length < 3 || address.postalCode.length > 10) {
        throw new ValidationError('Code postal invalide');
    }
};