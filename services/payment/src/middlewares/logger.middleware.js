/**
 * @module Middleware/RequestLogger
 *
 * Journalise chaque requête HTTP avec sa durée et son statut.
 * Actif uniquement hors production et hors test : en production,
 * la surveillance des requêtes est déléguée à Sentry/APM.
 * Format : METHOD /url STATUS - Xms
 */
import { ENV } from '../config/environment.js';
import { logInfo } from '../utils/logger.js';

export const requestLogger = (req, res, next) => {
    if (ENV.server.nodeEnv === 'test') return next();

    const start = Date.now();
    const { method, originalUrl } = req;

    // L'événement 'finish' se déclenche une fois la réponse entièrement envoyée au client,
    // ce qui permet de mesurer la durée réelle du traitement côté serveur.
    res.on('finish', () => {
        const duration = Date.now() - start;
        const status = res.statusCode;

        // Codes couleur ANSI pour différencier visuellement les niveaux de statut en console
        let statusColor = '\x1b[32m'; // Vert  (2xx — succès)
        if (status >= 400) statusColor = '\x1b[33m'; // Jaune (4xx — erreur client)
        if (status >= 500) statusColor = '\x1b[31m'; // Rouge (5xx — erreur serveur)
        const reset = '\x1b[0m';

        logInfo(`${method} ${originalUrl} ${statusColor}${status}${reset} - ${duration}ms`);
    });

    next();
};