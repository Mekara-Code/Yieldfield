# The farm server for a VPS (docker compose up -d, see docker-compose.yml and README.md).
FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund

COPY . .
# Building the site loads the database client, which wants an address; the real one comes at run time.
RUN npx prisma generate \
 && DATABASE_URL="postgresql://build:build@localhost:5432/build" npx next build

EXPOSE 3000
# Applies any new migrations, then serves the site, the API and the WebSocket.
CMD ["npx", "tsx", "server.ts"]
