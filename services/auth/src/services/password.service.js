/**
 * @module Service/Password
 *
 * Gère le hachage et la vérification des mots de passe via PBKDF2.
 */
import crypto from 'crypto';
import { promisify } from 'util';
import { ENV } from '../config/environment.js';

const pbkdf2 = promisify(crypto.pbkdf2);

class PasswordService {
    // Normes OWASP 2024 : 100 000 itérations minimum pour PBKDF2-SHA512.
    #iterations = ENV.bcrypt?.iterations || 100000;
    #keylen = 64;
    #digest = 'sha512';

    constructor() {
        if (PasswordService.instance) return PasswordService.instance;
        PasswordService.instance = this;
        Object.freeze(this);
    }

    generateSalt(length = 16) {
        return crypto.randomBytes(length).toString('hex');
    }

    async hashPassword(password, salt) {
        if (!password || !salt) {
            throw new Error('Password and Salt are required for hashing');
        }

        const hash = await pbkdf2(password, salt, this.#iterations, this.#keylen, this.#digest);
        return hash.toString('hex');
    }

    /**
     * timingSafeEqual est utilisé à la place d'une comparaison directe (===)
     * pour éliminer les timing attacks qui permettent de deviner un hash bit par bit.
     */
    async comparePassword(password, storedHash, storedSalt) {
        try {
            const hashedAttempt = await this.hashPassword(password, storedSalt);
            const bufferStored = Buffer.from(storedHash, 'hex');
            const bufferAttempt = Buffer.from(hashedAttempt, 'hex');

            return crypto.timingSafeEqual(bufferStored, bufferAttempt);
        } catch {
            return false;
        }
    }
}

export const passwordService = new PasswordService();