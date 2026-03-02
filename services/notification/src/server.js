/**
 * @module Server
 *
 * Point d'entrée du notification-service.
 *
 * Ordre de démarrage :
 *   1. Sentry (instruments.js) — doit être le premier pour capturer toutes les erreurs
 *   2. Serveur HTTP Express — répond aux health checks dès le lancement
 *   3. Worker BullMQ — démarre après le serveur pour ne pas bloquer le déploiement
 *
 * Le worker est démarré dans le même process que le serveur HTTP car la charge
 * d'email est faible (pas de calcul intensif). Si la charge augmente,
 * le worker peut être extrait dans un process Node.js séparé sans modifier
 * le reste de l'architecture.
 */
import './config/instruments.js';

import app from './app.js';
import { ENV } from './config/environment.js';
import { connectPostgres, closePostgres } from './config/database.js';
import { startNotificationWorker } from './workers/notification.worker.js';
import { logInfo, logError } from './utils/logger.js';

process.on('uncaughtException', (err) => {
    logError(err, { event: 'uncaughtException' });
    process.exit(1);
});

const startServer = async () => {
    const port = ENV.server.port;

    // Le serveur HTTP démarre en premier pour que Render valide le déploiement
    // même si Neon met quelques secondes à accepter la connexion.
    const server = app.listen(port, '0.0.0.0', () => {
        logInfo(`notification-service en ligne [${ENV.server.nodeEnv}] → port ${port}`);
    });

    try {
        await connectPostgres();
    } catch (error) {
        // On log mais on ne quitte pas : le service répond aux healthchecks
        // pendant que Neon se reconnecte.
        logError(error, { step: 'database_connection_startup' });
    }

    // Le worker démarre après le serveur — les jobs déjà en queue seront traités dès que
    // Redis est disponible (BullMQ gère la reconnexion automatiquement).
    const worker = startNotificationWorker();

    process.on('unhandledRejection', (err) => {
        logError(err, { event: 'unhandledRejection' });
        server.close(async () => {
            // Fermeture propre du worker pour éviter les jobs stalled
            await worker.close();
            logInfo('Serveur et worker fermés suite à unhandledRejection');
            process.exit(1);
        });
    });

    // Arrêt propre : on vide la queue en cours avant de fermer
    const gracefulShutdown = async (signal) => {
        logInfo(`Signal ${signal} reçu — arrêt propre`);
        server.close(async () => {
            await worker.close();
            await closePostgres();
            logInfo('Notification-service arrêté proprement');
            process.exit(0);
        });
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
};

startServer();
