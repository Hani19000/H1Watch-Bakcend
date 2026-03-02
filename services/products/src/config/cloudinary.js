/**
 * @module Config/Cloudinary
 *
 * Configure le client Cloudinary v2 et expose :
 *  - `uploadCloud`         : instance Multer prête à l'emploi (stockage direct en mémoire → Cloudinary)
 *  - `cloudinary`          : instance Cloudinary (pour les suppressions, transformations, etc.)
 *  - `buildCloudinaryUrl`  : utilitaire pour injecter f_auto/q_auto dans une URL existante
 *
 * Stratégie : moteur de stockage Multer personnalisé qui streame le buffer
 * directement vers l'API Cloudinary v2 upload_stream, sans écriture disque.
 */

import { v2 as cloudinary } from 'cloudinary';
import multer from 'multer';
import { ENV } from './environment.js';
import { ValidationError } from '../utils/appError.js';

// ─── Configuration Cloudinary ────────────────────────────────────────────────

cloudinary.config({
    cloud_name: ENV.cloudinary.cloudName,
    api_key: ENV.cloudinary.apiKey,
    api_secret: ENV.cloudinary.apiSecret,
});

// ─── Constantes upload ───────────────────────────────────────────────────────

const ALLOWED_MIME_TYPES = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/avif',
]);

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Paramètres Cloudinary appliqués à chaque upload.
 * Les transformations sont exécutées une fois puis CDN-cachées.
 */
const CLOUDINARY_UPLOAD_PARAMS = {
    folder: 'fburger',
    allowed_formats: ['jpg', 'png', 'webp', 'avif'],
    transformation: [
        {
            width: 800,
            height: 800,
            crop: 'limit',
            fetch_format: 'auto',
            quality: 'auto',
        },
    ],
};

// ─── Moteur de stockage Multer custom (Cloudinary v2) ────────────────────────

/**
 * Implémente l'interface StorageEngine de Multer.
 * Streame le buffer en mémoire directement vers Cloudinary via upload_stream,
 * sans aucune écriture sur le disque du serveur.
 *
 * Après upload, req.file contient :
 *  - path     : URL sécurisée Cloudinary (secure_url)
 *  - filename : public_id Cloudinary (nécessaire pour les suppressions)
 *  - size     : poids en octets du fichier transformé
 */
class CloudinaryStorageEngine {
    /**
     * @param {object}                    options
     * @param {import('cloudinary').v2}   options.cloudinaryInstance - Client Cloudinary configuré
     * @param {object}                    options.params             - Paramètres upload Cloudinary
     */
    constructor({ cloudinaryInstance, params }) {
        this._cloudinary = cloudinaryInstance;
        this._params = params;
    }

    /**
     * Appelé par Multer pour traiter chaque fichier entrant.
     * @param {import('express').Request} req
     * @param {import('multer').File}     file
     * @param {Function}                  callback - callback(err, fileInfo)
     */
    _handleFile(req, file, callback) {
        const uploadStream = this._cloudinary.uploader.upload_stream(
            this._params,
            (error, result) => {
                if (error) {
                    return callback(new Error(`Cloudinary upload failed: ${error.message}`));
                }

                callback(null, {
                    path: result.secure_url,
                    filename: result.public_id,
                    size: result.bytes,
                });
            }
        );

        file.stream.pipe(uploadStream);
    }

    /**
     * Appelé par Multer lors d'un rollback (erreur en aval du pipeline).
     * Supprime la ressource Cloudinary si elle a déjà été uploadée.
     * @param {import('express').Request} _req
     * @param {import('multer').File}     file
     * @param {Function}                  callback
     */
    _removeFile(_req, file, callback) {
        if (file.filename) {
            this._cloudinary.uploader.destroy(file.filename, (error) => {
                callback(error ?? null);
            });
        } else {
            callback(null);
        }
    }
}

// ─── Instance Multer ─────────────────────────────────────────────────────────

const fileFilter = (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new ValidationError(
            'Format invalide : seules les images (jpg, png, webp, avif) sont autorisées.'
        ));
    }
};

const storage = new CloudinaryStorageEngine({
    cloudinaryInstance: cloudinary,
    params: CLOUDINARY_UPLOAD_PARAMS,
});

export const uploadCloud = multer({
    storage,
    fileFilter,
    limits: { fileSize: MAX_FILE_SIZE_BYTES },
});

// ─── Exports ─────────────────────────────────────────────────────────────────

export { cloudinary };

/**
 * Construit une URL Cloudinary optimisée à partir d'une URL brute déjà stockée.
 *
 * Injecte les transformations f_auto/q_auto dans l'URL CDN
 * sans modifier la ressource source.
 *
 * @param {string} rawUrl               - URL Cloudinary brute (https://res.cloudinary.com/…)
 * @param {object} [options]
 * @param {number} [options.width=800]  - Largeur max (px)
 * @param {number} [options.height=800] - Hauteur max (px)
 * @returns {string} URL avec f_auto,q_auto,w_X,h_Y,c_limit injectées
 */
export function buildCloudinaryUrl(rawUrl, { width = 800, height = 800 } = {}) {
    if (!rawUrl || !rawUrl.includes('res.cloudinary.com')) return rawUrl;
    if (rawUrl.includes('f_auto')) return rawUrl; // déjà transformée

    const transformations = `f_auto,q_auto,w_${width},h_${height},c_limit`;
    return rawUrl.replace('/upload/', `/upload/${transformations}/`);
}