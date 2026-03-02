/**
 * @module Config/Vitest
 *
 * Configuration Vitest du cart-service.
 *
 * IMPORTANT — CONTEXTE MONOREPO :
 * Vitest est lancé depuis la racine du monorepo (`npm test` à la racine).
 * Ce fichier N'EST PAS lu automatiquement dans ce contexte — il ne sert
 * que si vitest est lancé directement depuis services/cart/.
 *
 * Les variables d'environnement requises par environment.js sont donc
 * déclarées dans le bloc `env` du job CI racine (.github/workflows/CI.yaml),
 * qui s'applique à TOUS les fichiers de test découverts par vitest,
 * quel que soit leur sous-répertoire.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        globals: true,
        include: ['src/tests/**/*.test.js'],
    },
});
