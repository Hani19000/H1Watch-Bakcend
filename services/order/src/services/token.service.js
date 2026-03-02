/**
 * @module Service/Token
 *
 * Gère la génération et la vérification des JWT (access et refresh tokens).
 */
import jwt from 'jsonwebtoken';
import { ENV } from '../config/environment.js';

class TokenService {
    #accessSecret = ENV.jwt.accessTokenSecret;
    #refreshSecret = ENV.jwt.refreshTokenSecret;
    #accessExpiry = ENV.jwt.accessTokenExpiry || '15m';
    #refreshExpiry = ENV.jwt.refreshTokenExpiry || '7d';

    constructor() {
        if (TokenService.instance) return TokenService.instance;
        TokenService.instance = this;
        Object.freeze(this);
    }

    /**
     * L'access token a une courte durée de vie (15 min par défaut) pour limiter
     * la fenêtre d'exploitation en cas de fuite. Le refresh token compense
     * en permettant de renouveler sans redemander les credentials.
     */
    generateAccessToken(user) {
        return jwt.sign(
            {
                sub: user.id,
                email: user.email,
                roles: user.roles || [],
            },
            this.#accessSecret,
            {
                expiresIn: this.#accessExpiry,
                issuer: 'mon-ecommerce-api',
                audience: 'mon-ecommerce-client',
            }
        );
    }

    generateRefreshToken(user) {
        return jwt.sign(
            { sub: user.id },
            this.#refreshSecret,
            { expiresIn: this.#refreshExpiry }
        );
    }

    verifyAccessToken(token) {
        try {
            return jwt.verify(token, this.#accessSecret);
        } catch {
            return null;
        }
    }

    verifyRefreshToken(token) {
        try {
            return jwt.verify(token, this.#refreshSecret);
        } catch {
            return null;
        }
    }

    /**
     * Utilisé pour extraire l'ID utilisateur d'un token expiré
     * (ex : débogage, rotation de clé) sans lever d'erreur de signature.
     */
    decodeToken(token) {
        return jwt.decode(token);
    }
}

export const tokenService = new TokenService();