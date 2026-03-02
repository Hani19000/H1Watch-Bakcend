FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm install --omit=dev

COPY . .

EXPOSE 3003

CMD ["node", "src/server.js"]