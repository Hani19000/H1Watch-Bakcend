/**
 * @module Server
 *
 * Point d'entrée du admin-service.
 * Sentry importé EN PREMIER pour instrumenter toutes les dépendances.
 */
import './config/instruments.js';

import app from './app.js';
import { ENV } from './config/environment.js';
import { initializeCronJobs, shutdownCronJobs } from './jobs/index.js';
import { logInfo, logError } from './utils/logger.js';

process.on('uncaughtException', (err) => {
    logError(err, { event: 'uncaughtException' });
    process.exit(1);
});

const startServer = async () => {
    const port = ENV.server.port;

    // Le serveur écoute AVANT l'initialisation des crons pour que Render valide le déploiement.
    const server = app.listen(port, '0.0.0.0', () => {
        logInfo(`admin-service [${ENV.server.nodeEnv}] démarré sur le port ${port}`);
    });

    // Initialiser les cron jobs après que le serveur soit prêt.
    initializeCronJobs();

    process.on('unhandledRejection', (err) => {
        logError(err, { event: 'unhandledRejection' });
        server.close(() => process.exit(1));
    });

    const shutdown = (signal) => {
        logInfo(`Signal ${signal} reçu — arrêt gracieux`);
        shutdownCronJobs();
        server.close(() => {
            logInfo('admin-service arrêté proprement');
            process.exit(0);
        });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
};

startServer();
