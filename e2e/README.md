# e2e

Playwright suite. Config is `playwright.config.ts` at the repo root, because a run
needs both workspaces up: Vite on :5173 and Fastify on :3000.

## Prerequisites

```
docker compose up -d                      # postgres:16-alpine on :5432
cp backend/.env.example backend/.env      # gitignored; NODE_ENV must not be "production"
npm run db:migrate --workspace=backend
npx playwright install chromium
```

Ports 3000 and 5173 must be free — the config starts its own servers and does not
reuse existing ones.

## Run

```
npm run e2e                  # all specs
npm run e2e -- --headed      # watch it
npx playwright show-report
```

Output goes to `test-results/` and `playwright-report/`, both gitignored. (This is a
different mechanism from the Playwright **MCP** server, whose artifacts belong in
`.playwright-mcp/`.)

## How it works

`globalSetup` (`fixtures/auth.ts`) signs a fresh user in for real: `POST /auth/sign-in`,
then scrapes `test-results/backend.log` — into which the config tees the backend's
stdout — for the `[magic-link] …?token=…` line the backend prints outside production,
then `POST /auth/token/verify?token=…`. It writes `test-results/.auth/storage-state.json`
holding the `pet_tracker_token` cookie plus three localStorage keys against
`http://localhost:5173`: `petmeds.store.ownerUserId`, `petmeds.session.established`, and
`petmeds.language` = `en` (the app defaults to Ukrainian).

`fixtures/seed.ts` loads a household through the app's own Settings → Import JSON →
Replace everything flow, rather than writing IndexedDB by hand.

Specs pin time with `page.clock.install()` before the first navigation, and the config
pins `timezoneId: "UTC"` so the seed's ISO instants match the wall-clock times the
screen renders.

Navigate specs to `/today` directly. `/` calls `GET /api/household` and bounces a user
with no server-side household to `/welcome`.
