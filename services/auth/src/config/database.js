/**
 * @module Config/Database
 *
 * Initialisation et gestion du pool de connexions PostgreSQL.
 * Adapté pour supporter les URLs de connexion Cloud (Neon) et les paramètres classiques.
 */
import pkg from 'pg';
const { Pool } = pkg;
import { ENV } from './environment.js';
import { logInfo, logError } from '../utils/logger.js';

/**
 * Priorise l'URL complète (DATABASE_URL) car elle contient souvent des paramètres
 * spécifiques au pooler (comme chez Neon).
 */
const poolConfig = ENV.database.postgres.url
    ? {
        connectionString: ENV.database.postgres.url,
        ssl: { rejectUnauthorized: false }, // Requis par Neon et Render
    }
    : {
        user: ENV.database.postgres.user,
        password: ENV.database.postgres.password,
        host: ENV.database.postgres.host,
        port: ENV.database.postgres.port,
        database: ENV.database.postgres.database,
        ssl: ENV.server.isProduction ? { require: true, rejectUnauthorized: false } : false,
    };

const finalConfig = {
    ...poolConfig,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
};

export const pgPool = new Pool(finalConfig);

pgPool.on('connect', (client) => {
    client.query('SET search_path TO auth, public')
        .catch((err) => logError(err, { context: 'pgPool search_path init' }));
});

/**
 * Valide la connexion au démarrage (Fail-fast).
 */
export const connectPostgres = async () => {
    try {
        const connectionTarget = ENV.database.postgres.url
            ? 'Neon Cloud (URL)'
            : `${finalConfig.host}:${finalConfig.port}`;

        logInfo(`Tentative de connexion PostgreSQL → ${connectionTarget}`);

        const client = await pgPool.connect();
        logInfo('PostgreSQL connecté avec succès (Pool ready)');
        client.release();
    } catch (error) {
        logError(error, { context: 'PostgreSQL connection error' });
        throw error;
    }
};

/**
 * Fermeture propre du pool.
 */
export const closePostgres = async () => {
    try {
        await pgPool.end();
        logInfo('PostgreSQL pool fermé');
    } catch (error) {
        logError(error, { context: 'Error closing PostgreSQL pool' });
    }
};