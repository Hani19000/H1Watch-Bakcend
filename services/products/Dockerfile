# ─── Étape 1 : builder ───────────────────────────────────────────────────────
# Installe uniquement les dépendances de production dans un layer dédié.
FROM node:22-alpine AS builder

WORKDIR /app

# Copier les manifestes ET le .npmrc avant npm ci
# (npm ci utilise package-lock.json pour un install déterministe)
COPY package.json package-lock.json .npmrc ./

RUN npm ci --omit=dev

# ─── Étape 2 : image finale ──────────────────────────────────────────────────
# Repart d'une image propre pour ne pas embarquer npm, les caches, etc.
FROM node:22-alpine AS production

# Bonnes pratiques sécurité : ne pas tourner en root
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Récupérer uniquement node_modules depuis le builder
COPY --from=builder /app/node_modules ./node_modules

# Copier le code source
COPY src ./src
COPY package.json ./

# Changer le propriétaire des fichiers pour l'utilisateur non-root
RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 3003

# Lancement direct via node (pas npm start, évite un process inutile)
CMD ["node", "src/server.js"]