import app from './app.js';
import { ENV } from './config/environment.js';
import { connectPostgres } from './config/database.js';
import { logInfo, logError } from './utils/logger.js';

/**
 * Gestion des erreurs fatales synchrones.
 * On loggue et on quitte proprement car l'état de l'app est instable.
 */
process.on('uncaughtException', (err) => {
    logError(err, { event: 'uncaughtException' });
    process.exit(1);
});

const startServer = async () => {
    const port = ENV.server.port;

    // Le serveur écoute avant la connexion DB pour que Render valide le déploiement
    // même si la base met du temps à répondre.
    const server = app.listen(port, '0.0.0.0', () => {
        logInfo(`Serveur en ligne [${ENV.server.nodeEnv}] sur le port ${port}`);
    });

    try {
        await connectPostgres();
    } catch (error) {
        logError(error, { step: 'database_connection_startup' });
    }

    /**
     * Gestion des promesses rejetées non capturées.
     */
    process.on('unhandledRejection', (err) => {
        logError(err, { event: 'unhandledRejection' });
        server.close(() => {
            logInfo('Serveur fermé suite à unhandledRejection');
            process.exit(1);
        });
    });
};

startServer();