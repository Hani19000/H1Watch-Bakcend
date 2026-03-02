/**
 * @module Service/Token
 *
 * Vérification des JWT Access Tokens émis par l'auth-service.
 * Le payment-service ne génère pas de tokens — il les valide uniquement.
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
     * Retourne null plutôt que de lancer une exception pour permettre
     * un traitement gracieux dans les middlewares.
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