FROM node:22-alpine AS builder

RUN apk add --no-cache dumb-init

RUN addgroup -S nodejs && adduser -S nodejs -G nodejs

WORKDIR /app

COPY package.json package-lock.json ./

COPY backend/package.json ./backend/
COPY packages/shared/package.json ./packages/shared/

RUN npm ci

COPY packages/shared/ ./packages/shared/
COPY backend/src/ ./backend/src/
COPY backend/tsconfig.json ./backend/
COPY backend/drizzle/ ./backend/drizzle/

# Build the shared package FIRST.
# Why: backend/tsconfig.json has a path alias "@pet-tracker/shared" that
# TypeScript resolves to ../packages/shared/src/index.ts. The shared package's
# package.json exports point to ./dist/index.js — that file must exist before
# Node can require it at runtime.
RUN npm run build --workspace=packages/shared

# Compile the backend TypeScript.
# tsconfig outDir is "dist" (relative to backend/), but because the tsconfig's
# paths include ../packages/shared (outside the project root), TypeScript infers
# rootDir as the monorepo root and mirrors the full path in the output:
#   backend/src/server.ts  →  backend/dist/backend/src/server.js
# This is expected behaviour; the start:prod script accounts for it.
RUN npm run build:ts --workspace=backend

RUN npm prune --omit=dev

FROM node:22-alpine AS release

RUN apk add --no-cache dumb-init

RUN addgroup -S nodejs && adduser -S nodejs -G nodejs

WORKDIR /app

COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules

COPY --from=builder --chown=nodejs:nodejs /app/backend/dist ./backend/dist

COPY --from=builder --chown=nodejs:nodejs /app/backend/drizzle ./backend/drizzle

# Copy the compiled shared package directory.
# node_modules/@pet-tracker/shared is an npm workspace symlink pointing to
# ../../packages/shared. For Node to resolve that symlink at runtime, the actual
# packages/shared directory (with its compiled dist/) must exist on the filesystem.
COPY --from=builder --chown=nodejs:nodejs /app/packages/shared ./packages/shared

COPY --chmod=755 backend/entrypoint.sh /app/entrypoint.sh

ENV NODE_ENV=production

ENV NODE_OPTIONS="--enable-source-maps"

USER nodejs

EXPOSE ${PORT:-3000}

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT:-3000}/health || exit 1

ENTRYPOINT ["dumb-init", "--"]

CMD ["/app/entrypoint.sh"]
