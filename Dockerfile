# Build stage: compile TS (server) and bundle the Vue client.
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig*.json vite.config.ts vitest.config.ts index.html ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

# Runtime stage: production deps + compiled output only.
FROM node:24-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

EXPOSE 3000
CMD ["sh", "dist/start.sh"]
