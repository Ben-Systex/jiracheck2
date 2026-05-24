# =============================================================================
# Frontend Dockerfile — multi-stage
# stage `deps`  : 安裝相依（dev + prod 一視同仁，Angular 19 build 需要）
# stage `dev`   : 開發用 `ng serve`
# stage `build` : `ng build --configuration=production`
# stage `prod`  : nginx 提供靜態檔
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
COPY . .
EXPOSE 4200
CMD ["npx", "ng", "serve", "--host", "0.0.0.0", "--port", "4200"]

# --- build --------------------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx ng build --configuration=production

# --- prod ---------------------------------------------------------------------
FROM nginx:1.27-alpine AS prod
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/frontend/browser /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
