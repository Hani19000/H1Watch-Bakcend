FROM node:22-alpine

WORKDIR /app

# Copie uniquement les fichiers de dépendances en premier (cache Docker)
COPY package.json package-lock.json* ./

RUN npm install --omit=dev

# Copie le reste du code
COPY . .

EXPOSE 3002

CMD ["node", "src/server.js"]