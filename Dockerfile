# ── Stage 1: Build the Vue frontend ───────────────────────────────────────────
FROM node:24-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Compile the TypeScript server ─────────────────────────────────────
FROM node:24-alpine AS server-build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build:server

# ── Stage 3: Production runtime ────────────────────────────────────────────────
FROM node:24-alpine AS runtime
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=server-build /app/dist ./dist
COPY --from=frontend-build /app/frontend/dist ./frontend/dist
EXPOSE 3000
CMD ["node", "dist/server.js"]
