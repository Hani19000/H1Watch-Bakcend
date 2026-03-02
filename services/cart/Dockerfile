FROM node:22-alpine

WORKDIR /app

# Copie uniquement les fichiers de dépendances en premier pour profiter du cache Docker.
# Une modification du code source ne réinstalle pas les dépendances si package.json est inchangé.
COPY package.json package-lock.json* ./

RUN npm install --omit=dev

COPY . .

EXPOSE 3006

CMD ["node", "src/server.js"]
