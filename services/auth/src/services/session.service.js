/**
 * @module Service/Session
 *
 * Gère la persistance des sessions avec une stratégie de cache hybride (Redis + DB).
 * Redis est utilisé comme couche rapide ; PostgreSQL reste la source de vérité.
 */
import { refreshTokensRepo } from '../repositories/index.js';
import { cacheService } from './cache.service.js';
import { logError } from '../utils/logger.js';
import { ENV } from '../config/environment.js';

class SessionService {
    // SameSite: None + Secure: true est requis pour les cookies cross-domain
    // (ex : frontend Vercel → API Render). En développement, les navigateurs bloquent
    // SameSite: None sans HTTPS, d'où le basculement sur Lax/false.
    #cookieOptions = {
        httpOnly: true,
        secure: true,
        sameSite: 'None',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000,
    };

    constructor() {
        if (SessionService.instance) return SessionService.instance;

        if (ENV.server.nodeEnv === 'development') {
            this.#cookieOptions.sameSite = 'Lax';
            this.#cookieOptions.secure = false;
        }

        SessionService.instance = this;
        Object.freeze(this);
    }

    async createSession(userId, refreshToken) {
        if (!userId || !refreshToken) throw new Error('Données de session manquantes');

        const expiresAt = new Date(Date.now() + this.#cookieOptions.maxAge);

        await refreshTokensRepo.create({ userId, token: refreshToken, expiresAt });

        // Le TTL Redis est synchronisé avec le cookie pour éviter des sessions
        // valides en DB mais absentes du cache (incohérence self-healing).
        await cacheService.set(
            `session:${refreshToken}`,
            { userId, expiresAt },
            Math.floor(this.#cookieOptions.maxAge / 1000)
        );
    }

    async validateSession(refreshToken) {
        if (!refreshToken) return null;

        try {
            const cachedSession = await cacheService.get(`session:${refreshToken}`);
            if (cachedSession) return cachedSession;
        } catch (error) {
            // Si Redis est indisponible, on continue vers PostgreSQL plutôt que
            // de bloquer l'utilisateur — le cache est une optimisation, pas une source de vérité.
            logError(error, { context: 'SessionService.validateSession' });
        }

        const session = await refreshTokensRepo.findByToken(refreshToken);

        // Self-healing : reconstruction du cache si la session existe en DB mais pas dans Redis.
        if (session) {
            await cacheService.set(
                `session:${refreshToken}`,
                { userId: session.userId, expiresAt: session.expiresAt },
                3600
            );
        }

        return session;
    }

    async deleteSession(refreshToken) {
        if (!refreshToken) return;

        const session = await refreshTokensRepo.findByToken(refreshToken);

        await Promise.all([
            session ? refreshTokensRepo.revokeById(session.id) : Promise.resolve(),
            cacheService.delete(`session:${refreshToken}`),
        ]);
    }
}

export const sessionService = new SessionService();