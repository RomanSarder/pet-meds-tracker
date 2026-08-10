// Authentication for the e2e suite: one real magic-link round trip, recorded
// as a `storageState` every spec reuses.
//
// The app has no dev bypass, no test token, no seed endpoint and no env flag,
// and adding a backend route to create one would be new production auth
// surface bought for a test convenience. So this drives the same three calls
// a human does: POST /auth/sign-in, capture the token, POST
// /auth/token/verify?token=… (querystring, NOT body).
//
// TOKEN CAPTURE: SCRAPING THE BACKEND LOG.
// `backend/src/email/index.ts` prints `[magic-link] <verifyUrl>` to stdout
// whenever NODE_ENV !== "production". `playwright.config.ts` tees the
// backend's stdout into `test-results/backend.log`, and this file tails it.
//
// The rejected alternative was querying `magic_link_tokens` in Postgres
// directly. It works, but it costs a `postgres`/`drizzle` client dependency in
// the test layer and, worse, couples the harness to the auth table's column
// names and the DATABASE_URL — a second place that must be edited every time
// the schema moves, and one that fails confusingly (empty result set) rather
// than loudly. The log line is a single string, is already a deliberate
// developer-facing affordance, and is the thing a human actually reads to sign
// in locally. It is also the ONLY coupling here that a schema change cannot
// silently break.
import fs from "node:fs/promises";
import path from "node:path";
import { request, type APIRequestContext } from "@playwright/test";

export const FRONTEND_ORIGIN = "http://localhost:5173";

const ROOT = path.resolve(__dirname, "..", "..");
export const BACKEND_LOG_PATH = path.join(ROOT, "test-results", "backend.log");
export const STORAGE_STATE_PATH = path.join(ROOT, "test-results", ".auth", "storage-state.json");

/** `backend/src/auth/utils.ts` — 24 chars from a confusable-free alphabet. */
const TOKEN_PATTERN = /\[magic-link\]\s+\S*\/auth\/verify\?token=([abcdefghijkmnpqrstuvwxyz23456789]{24})/g;

const TOKEN_TIMEOUT_MS = 20_000;
const POLL_MS = 100;

/** Session localStorage keys — see `frontend/src/shared/session.ts` and `frontend/src/i18n/locale.ts`. */
const SESSION_ESTABLISHED_KEY = "petmeds.session.established";
const STORE_OWNER_KEY = "petmeds.store.ownerUserId";
const LOCALE_KEY = "petmeds.language";

interface SessionUser {
  id: string;
  email: string;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function logSize(): Promise<number> {
  try {
    return (await fs.stat(BACKEND_LOG_PATH)).size;
  } catch {
    return 0;
  }
}

/** Everything appended to the backend log since `fromByte`. */
async function logSince(fromByte: number): Promise<string> {
  try {
    const buffer = await fs.readFile(BACKEND_LOG_PATH);
    return buffer.subarray(fromByte).toString("utf8");
  } catch {
    return "";
  }
}

/**
 * The newest magic-link token printed after `fromByte`. Anchored to an offset
 * taken BEFORE sign-in so a rerun never picks up a spent token from an earlier
 * request in the same log — the verify endpoint is single-use, so a stale
 * token fails as a flat 401 with nothing to explain it.
 */
async function waitForMagicLinkToken(fromByte: number): Promise<string> {
  const deadline = Date.now() + TOKEN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const matches = [...(await logSince(fromByte)).matchAll(TOKEN_PATTERN)];
    const last = matches.at(-1);
    if (last) return last[1];
    await sleep(POLL_MS);
  }
  throw new Error(
    `No [magic-link] line appeared in ${BACKEND_LOG_PATH} within ${TOKEN_TIMEOUT_MS}ms. ` +
      "The backend only prints it when NODE_ENV !== \"production\" — check backend/.env.",
  );
}

/**
 * Signs a fresh user in and returns a request context already carrying the
 * session cookie, plus the server's own view of who that user is.
 *
 * A NEW address per run, deliberately: `/auth/sign-in` upserts the user, so
 * reusing one address would accumulate sessions and, more importantly, would
 * let one run's leftover local IndexedDB be judged as belonging to this run's
 * user by `appLayoutRoute`'s store-ownership check.
 */
export async function signInFreshUser(): Promise<{ api: APIRequestContext; user: SessionUser }> {
  // Through the frontend origin, not :3000 — the cookie must be recorded
  // against localhost as the app sees it, and the Vite proxy is the path the
  // app itself uses (`apiClient` fetches `/api/*` with credentials:"include").
  const api = await request.newContext({ baseURL: FRONTEND_ORIGIN });

  const email = `e2e-${Date.now()}-${process.pid}@example.com`;
  const before = await logSize();

  const signIn = await api.post("/api/auth/sign-in", { data: { email } });
  if (!signIn.ok()) {
    throw new Error(`POST /auth/sign-in failed: ${signIn.status()} ${await signIn.text()}`);
  }

  const token = await waitForMagicLinkToken(before);

  // Querystring, not body — see `backend/src/auth/index.ts`.
  const verify = await api.post(`/api/auth/token/verify?token=${token}`);
  if (!verify.ok()) {
    throw new Error(`POST /auth/token/verify failed: ${verify.status()} ${await verify.text()}`);
  }

  const me = await api.get("/api/auth/me");
  if (!me.ok()) {
    throw new Error(`GET /auth/me failed after verify: ${me.status()} ${await me.text()}`);
  }

  return { api, user: (await me.json()) as SessionUser };
}

/**
 * Playwright `globalSetup`. Writes a storage state carrying BOTH halves of
 * what the app needs to enter a route under `appLayoutRoute`:
 *
 *  - the `pet_tracker_token` cookie, so `GET /api/auth/me` returns 200
 *    instead of the 401 that redirects to /sign-in;
 *  - `petmeds.store.ownerUserId` = this session's user id, so the
 *    store-ownership check takes neither the local-reset nor the
 *    /account-switch branch;
 *  - `petmeds.session.established`, the flag that lets the shell render when
 *    the backend is unreachable;
 *  - `petmeds.language` = "en". NOT optional housekeeping: `DEFAULT_LOCALE`
 *    is "uk" (frontend/src/i18n/locale.ts), so without this the Settings
 *    import buttons this suite clicks read "Імпортувати JSON".
 */
export default async function globalSetup(): Promise<void> {
  const { api, user } = await signInFreshUser();

  const state = await api.storageState();
  const cookie = state.cookies.find((c) => c.name === "pet_tracker_token");
  if (!cookie) {
    throw new Error("verify succeeded but no pet_tracker_token cookie was recorded");
  }

  state.origins = [
    {
      origin: FRONTEND_ORIGIN,
      localStorage: [
        { name: SESSION_ESTABLISHED_KEY, value: "true" },
        { name: STORE_OWNER_KEY, value: user.id },
        { name: LOCALE_KEY, value: "en" },
      ],
    },
  ];

  await fs.mkdir(path.dirname(STORAGE_STATE_PATH), { recursive: true });
  await fs.writeFile(STORAGE_STATE_PATH, JSON.stringify(state, null, 2), "utf8");
  await api.dispose();
}
