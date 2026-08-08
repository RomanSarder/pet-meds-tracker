FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./

COPY frontend/package.json ./frontend/
COPY packages/shared/package.json ./packages/shared/

RUN npm ci

COPY packages/shared/ ./packages/shared/
COPY frontend/ ./frontend/

# Build the shared package FIRST.
# Why: frontend/tsconfig.json has a path alias "@pet-tracker/shared" that
# TypeScript resolves to ../packages/shared/src/index.ts. The shared package's
# package.json exports point to ./dist/index.js — that file must exist before
# Vite can bundle it at build time.
RUN npm run build --workspace=packages/shared

RUN npm run build --workspace=frontend

FROM nginx:1.27-alpine AS release

RUN apk add --no-cache dumb-init

COPY --from=builder /app/frontend/dist /usr/share/nginx/html

COPY frontend/nginx.conf.template /etc/nginx/templates/default.conf.template

COPY --chmod=755 frontend/entrypoint.sh /entrypoint.sh

# Allow nginx user to write pid file and cache dirs on port 8080 (no root needed)
RUN chown -R nginx:nginx /var/cache/nginx /var/log/nginx /usr/share/nginx/html \
    && touch /var/run/nginx.pid \
    && chown nginx:nginx /var/run/nginx.pid \
    && mkdir -p /etc/nginx/conf.d \
    && chown -R nginx:nginx /etc/nginx/conf.d

USER nginx

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

ENTRYPOINT ["dumb-init", "--"]

CMD ["/entrypoint.sh"]
