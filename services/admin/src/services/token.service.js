/**
 * @module Service/Token
 *
 * Gère uniquement la vérification des JWT Access Tokens.
 *
 * L'admin-service ne génère pas de tokens — il les valide uniquement.
 * La génération est la responsabilité exclusive de l'auth-service.
 */
import jwt from 'jsonwebtoken';
import { ENV } from '../config/environment.js';

class TokenService {
    #accessSecret = ENV.jwt.accessTokenSecret;

    constructor() {
        if (TokenService.instance) return TokenService.instance;
        TokenService.instance = this;
        Object.freeze(this);
    }

    /**
     * Vérifie la signature et l'expiration du token.
     * Retourne null si le token est invalide plutôt que de lancer une exception —
     * le middleware `protect` est responsable de la gestion du cas null.
     *
     * @param {string} token
     * @returns {object|null} Payload décodé ou null
     */
    verifyAccessToken(token) {
        try {
            return jwt.verify(token, this.#accessSecret);
        } catch {
            return null;
        }
    }
}

export const tokenService = new TokenService();
