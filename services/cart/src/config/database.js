/**
 * @module Config/Database
 *
 * Pool PostgreSQL du cart-service.
 * Le search_path est positionné sur "cart" à chaque nouvelle connexion
 * pour que toutes les requêtes SQL ciblent le schéma dédié sans préfixe.
 */
import pkg from 'pg';
const { Pool } = pkg;
import { ENV } from './environment.js';
import { logInfo, logError } from '../utils/logger.js';

export const pgPool = new Pool({
    connectionString: ENV.database.postgres.url,
    ssl: { rejectUnauthorized: false }, // Requis par Neon et Render
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

/**
 * Positionne le search_path sur "cart" puis "public" (pour uuid-ossp et extensions).
 * Sans cette ligne, les requêtes échoueraient avec "table not found".
 */
pgPool.on('connect', (client) => {
    client.query('SET search_path TO cart, public')
        .catch((err) => logError(err, { context: 'pgPool search_path init (cart-service)' }));
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
