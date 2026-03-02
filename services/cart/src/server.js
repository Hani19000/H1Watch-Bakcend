/**
 * @module Server
 *
 * Point d'entrée du cart-service.
 * Sentry instruments.js importé EN PREMIER pour instrumenter toutes les dépendances.
 */
import './config/instruments.js';

import app from './app.js';
import { ENV } from './config/environment.js';
import { connectPostgres, closePostgres } from './config/database.js';
import { logInfo, logError } from './utils/logger.js';

process.on('uncaughtException', (err) => {
    logError(err, { event: 'uncaughtException' });
    process.exit(1);
});

const startServer = async () => {
    const port = ENV.server.port;

    // Le serveur écoute avant la connexion DB pour que Render valide le déploiement
    // même si Neon met du temps à répondre au premier cold start.
    const server = app.listen(port, '0.0.0.0', () => {
        logInfo(`cart-service [${ENV.server.nodeEnv}] démarré sur le port ${port}`);
    });

    try {
        await connectPostgres();
    } catch (error) {
        logError(error, { step: 'database_connection_startup' });
    }

    process.on('unhandledRejection', (err) => {
        logError(err, { event: 'unhandledRejection' });
        server.close(() => {
            logInfo('Serveur fermé suite à unhandledRejection');
            process.exit(1);
        });
    });

    // Graceful shutdown pour Render
    const shutdown = async (signal) => {
        logInfo(`Signal ${signal} reçu — arrêt gracieux`);
        server.close(async () => {
            await closePostgres();
            logInfo('cart-service arrêté proprement');
            process.exit(0);
        });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
};

startServer();
