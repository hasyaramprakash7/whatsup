# One image for both the API server and the broadcast worker (docker-compose picks the command).
FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

# Install production dependencies first so this layer is cached between code changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# Multer writes temporary uploads here; the app runs as the unprivileged "node" user.
RUN mkdir -p uploads && chown -R node:node /app/uploads
USER node

EXPOSE 3000
CMD ["node", "server.js"]
