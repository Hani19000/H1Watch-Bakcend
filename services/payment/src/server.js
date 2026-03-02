/**
 * @module Server
 *
 * Point d'entrée du payment-service.
 * Sentry est initialisé en premier (instruments.js) pour capturer
 * toutes les erreurs dès le démarrage, y compris celles de la connexion DB.
 */
import './config/instruments.js';

import app from './app.js';
import { ENV } from './config/environment.js';
import { connectPostgres } from './config/database.js';
import { logInfo, logError } from './utils/logger.js';

/**
 * Gestion des erreurs synchrones fatales.
 * L'état de l'app est potentiellement corrompu — arrêt immédiat.
 */
process.on('uncaughtException', (err) => {
    logError(err, { event: 'uncaughtException' });
    process.exit(1);
});

const startServer = async () => {
    const port = ENV.server.port;

    // Le serveur écoute avant la connexion DB pour que Render valide le déploiement
    // même si Neon met quelques secondes à répondre.
    const server = app.listen(port, '0.0.0.0', () => {
        logInfo(`payment-service en ligne [${ENV.server.nodeEnv}] → port ${port}`);
    });

    try {
        await connectPostgres();
    } catch (error) {
        // On log mais on ne quitte pas : le service peut répondre aux healthchecks
        // pendant que la DB se reconnecte.
        logError(error, { step: 'database_connection_startup' });
    }

    /**
     * Les rejets non gérés arrêtent le serveur proprement pour éviter
     * une accumulation de fichiers handles corrompus.
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
