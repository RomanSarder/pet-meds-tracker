# Pet Tracker

An npm-workspaces monorepo combining a Fastify 5 + Drizzle + Postgres backend that provides magic-link authentication and session management, with a Vite 6 + React 19 frontend (TanStack Router + Query, Tailwind 3 + shadcn/ui) featuring a single protected page. The backend intentionally contains authentication only; all business logic is deferred for future development.

## Prerequisites

- Node.js 20+
- npm
- Docker

## Setup

### 1. Configure git hooks

```bash
git config core.hooksPath .githooks
```

This is required once per clone. The repository enforces single-line commit messages through this hook.

### 2. Start infrastructure

```bash
docker compose up -d
```

Starts PostgreSQL 16 on port 5432 (credentials: `pet`/`pet`, database: `pet_tracker`).

### 3. Install dependencies

```bash
npm ci
```

### 4. Set up backend environment

```bash
cp backend/.env.example backend/.env
```

This copies a development-ready configuration. No edits needed for local development.

### 5. Run database migrations

```bash
npm run db:migrate --workspace=backend
```

### 6. Start the backend (terminal 1)

```bash
npm run dev --workspace=backend
```

Fastify API on http://localhost:3000.

### 7. Start the frontend (terminal 2)

```bash
npm run dev --workspace=frontend
```

Vite dev server on http://localhost:5173. The dev server proxies `/api/*` requests to the backend at http://localhost:3000.

## Signing in locally

In development, magic links are not sent via email. Instead, the backend logs the link to the console:

```
[magic-link] http://localhost:5173/auth/verify?token=…
```

Copy that URL into your browser to complete sign-in. Magic links expire after 15 minutes and are single-use. Sessions last 7 days and slide on each authenticated request.

## API

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/auth/sign-in` | Request a magic link |
| `POST` | `/auth/token/verify` | Verify and redeem a magic link token |
| `GET` | `/auth/me` | Fetch the current user's session |
| `POST` | `/auth/sign-out` | Sign out the current session |
| `GET` | `/health` | Health check (used by Docker, safe to poll) |

## Layout

```
backend/            Fastify API server
  src/
    auth/           Authentication endpoints and middleware
    db/             Drizzle schema and migrations
    email/          Magic link email rendering (dev logs to console)

frontend/           Vite + React SPA
  src/
    auth/           Sign-in and verification pages
    pages/          Protected page (requires authenticated session)

packages/shared/    Shared types and constants
  src/
    index.ts        Authentication types, magic link constants
```

## Useful commands

```bash
# Build both apps (frontend for production, backend for development)
npm run build --workspace=frontend
npm run build:ts --workspace=backend

# Type-check
npm run build:ts --workspace=backend

# Run tests (backend only)
npm run test --workspace=backend

# Database
npm run db:generate --workspace=backend  # Generate Drizzle migration files
npm run db:migrate --workspace=backend   # Run migrations
npm run db:studio --workspace=backend    # Open Drizzle Studio (visual DB editor)
```

## Production

Both apps have Dockerfiles for production deployment.

**Backend** (`backend/Dockerfile`):
- Multi-stage Node.js build on `node:22-alpine`
- Runs migrations on startup before starting the server
- Exposes port 3000 (configurable via `PORT` environment variable)
- Requires: `DATABASE_URL`, `NODE_ENV`, `FRONTEND_URL`, `FRONTEND_PUBLIC_URL`
- Also requires: `RESEND_API_KEY` and `RESEND_FROM_EMAIL` when `NODE_ENV=production`

**Frontend** (`frontend/Dockerfile`):
- Multi-stage build (Node.js to Vite) then `nginx:1.27-alpine`
- Serves on port 8080 (non-root nginx user)
- Proxies `/api/*` requests to backend (configurable via `BACKEND_URL` at startup)
- SPA history fallback: client-side routes like `/auth/verify` survive hard refresh
- Cache-busts static assets aggressively (Vite content hashing)
