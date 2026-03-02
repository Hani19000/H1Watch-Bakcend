FROM node:20-alpine

WORKDIR /usr/src/app

# Copie des fichiers de package en premier pour bénéficier du cache Docker.
# Une modification du code source ne réinstalle pas les dépendances si package.json est inchangé.
COPY package*.json ./

RUN npm install

# Copie du reste du code source
COPY . .

EXPOSE 3001

CMD ["npm", "start"]
