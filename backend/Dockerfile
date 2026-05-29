# =============================================================================
# Backend Dockerfile — multi-stage
# stage `deps`  : 安裝 production + dev 相依（用於 dev / test target）
# stage `dev`   : 開發用，含 tsx watch；由 docker-compose.dev.yml 引用
# stage `build` : tsc 編譯 → dist/
# stage `prod`  : 最終 image，僅含 production 相依與 dist/
# =============================================================================

# --- deps ---------------------------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# --- dev ----------------------------------------------------------------------
FROM node:20-alpine AS dev
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
COPY tests ./tests
EXPOSE 8080
CMD ["npm", "run", "dev"]

# --- build --------------------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
RUN npm run build

# --- prod ---------------------------------------------------------------------
FROM node:20-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
# 僅安裝 production 相依
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
EXPOSE 8080
USER node
CMD ["node", "dist/app.js"]
