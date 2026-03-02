# =============================================================================
# Dockerfile — admin-service
#
# Build multi-stage :
#   deps    — installe uniquement les dépendances de production
#   release — image finale légère, utilisateur non-root
#
# L'admin-service n'a pas de base de données propre.
# Il communique avec auth-service, order-service et product-service
# via HTTP (clients internes). Toutes les variables d'environnement
# sont injectées à l'exécution par Render — aucun secret en image.
# =============================================================================

# ── Stage 1 : dépendances de production ──────────────────────────────────────

FROM node:22-alpine AS deps

WORKDIR /app

# Copie uniquement les manifestes pour bénéficier du cache Docker.
# Le layer npm install n'est recalculé que si package*.json change.
COPY package*.json ./

# --omit=dev exclut nodemon et les autres devDependencies de l'image finale.
# --ignore-scripts empêche l'exécution de scripts postinstall non vérifiés.
RUN npm ci --omit=dev --ignore-scripts


# ── Stage 2 : image finale ───────────────────────────────────────────────────

FROM node:22-alpine AS release

# Métadonnées de l'image (OCI standard)
LABEL org.opencontainers.image.title="admin-service" \
      org.opencontainers.image.description="Agrégateur de statistiques et orchestrateur de cron jobs" \
      org.opencontainers.image.source="https://github.com/ecom-watch/backend"

WORKDIR /app

# Copie les dépendances compilées depuis le stage deps
COPY --from=deps /app/node_modules ./node_modules

# Copie le code source
COPY src ./src
COPY package.json ./

# Sécurité : exécution avec un utilisateur non-root.
# node:22-alpine inclut déjà l'utilisateur "node" (uid 1000).
USER node

# Port exposé par l'admin-service (défini dans environment.js)
EXPOSE 3008

# Utilise node directement (pas npm start) pour recevoir SIGTERM proprement.
# Le signal est transmis au processus Node sans passer par le shell npm,
# ce qui permet l'arrêt gracieux défini dans server.js.
CMD ["node", "src/server.js"]
