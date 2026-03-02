/**
 * @module Config/Database
 *
 * Pool PostgreSQL du notification-service.
 * Le search_path est positionné sur "notification" à chaque nouvelle connexion
 * pour que toutes les requêtes SQL ciblent le schéma dédié sans préfixe.
 *
 * Utilise l'URL directe (sans suffixe -pooler) pour que les paramètres
 * de search_path soient bien pris en compte par Neon.
 */
import pkg from 'pg';
const { Pool } = pkg;
import { ENV } from './environment.js';
import { logInfo, logError } from '../utils/logger.js';

export const pgPool = new Pool({
    connectionString: ENV.database.url,
    ssl: { rejectUnauthorized: false }, // Requis par Neon et Render
    max: 10,                            // Charge faible — le service écrit peu (log d'audit uniquement)
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

/**
 * Positionne le search_path sur "notification" puis "public" (pour uuid-ossp).
 * Sans cette ligne, les requêtes échoueraient avec "relation not found".
 */
pgPool.on('connect', (client) => {
    client.query('SET search_path TO notification, public')
        .catch((err) => logError(err, { context: 'pgPool search_path init (notification-service)' }));
});

export const connectPostgres = async () => {
    try {
        const client = await pgPool.connect();
        logInfo('PostgreSQL connecté avec succès (Pool ready)');
        client.release();
    } catch (error) {
        logError(error, { context: 'PostgreSQL connection error' });
        throw error;
    }
};

export const closePostgres = async () => {
    try {
        await pgPool.end();
        logInfo('PostgreSQL pool fermé');
    } catch (error) {
        logError(error, { context: 'Error closing PostgreSQL pool' });
    }
};
