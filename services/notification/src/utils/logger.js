/**
 * @module Utils/Logger
 *
 * Logger Winston partagé par l'application et le worker BullMQ.
 * Format JSON en production pour la collecte par les outils APM,
 * format lisible en développement pour faciliter le débogage.
 */
import { createLogger, format, transports } from 'winston';

const isProduction = process.env.NODE_ENV === 'production';

const logger = createLogger({
    level: isProduction ? 'info' : 'debug',
    format: isProduction
        ? format.combine(format.timestamp(), format.json())
        : format.combine(
              format.colorize(),
              format.timestamp({ format: 'HH:mm:ss' }),
              format.printf(({ level, message, timestamp }) => `${timestamp} ${level}: ${message}`)
          ),
    transports: [new transports.Console()],
});

export const logInfo  = (message, meta = {}) => logger.info(message, meta);
export const logError = (error, meta = {})   => logger.error(error?.message || error, { stack: error?.stack, ...meta });
export const logDebug = (message, meta = {}) => logger.debug(message, meta);
export const logWarn  = (message, meta = {}) => logger.warn(message, meta);
