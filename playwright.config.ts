// The e2e harness lives at the REPO ROOT, not inside `frontend/`, because a
// single run needs both workspaces up at once: the Vite dev server on :5173
// and the Fastify backend on :3000 (the app calls `/api/*` same-origin through
// Vite's proxy, and sign-in is a real magic-link round trip against Postgres).
// A config under `frontend/` would own a `webServer` that reaches out of its
// own workspace to boot the other one, and would put `e2e/` under a package
// whose `tsconfig`/`vitest` already claim `src/**`.
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { FRONTEND_ORIGIN, STORAGE_STATE_PATH } from "./e2e/fixtures/auth";

const ROOT = __dirname;

export default defineConfig({
  testDir: path.join(ROOT, "e2e"),
  outputDir: path.join(ROOT, "test-results"),
  // Serial by default: every worker shares one Postgres, one backend and one
  // Vite server, and the smoke spec drives a `replace`-mode import that
  // clobbers the whole local store. Raise this only for specs that own their
  // own household.
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  reporter: [["list"], ["html", { outputFolder: path.join(ROOT, "playwright-report"), open: "never" }]],

  // Signs in once against the running backend and writes the cookie + the
  // localStorage keys `appLayoutRoute.beforeLoad` reads. Runs after
  // `webServer` has both servers up, which is what lets it scrape the
  // backend's log for the magic link.
  globalSetup: require.resolve("./e2e/fixtures/auth"),

  use: {
    baseURL: FRONTEND_ORIGIN,
    storageState: STORAGE_STATE_PATH,
    // Pinned so `localDayKey`/`formatHHMM` (which are `getFullYear()`/
    // `getHours()`, i.e. LOCAL time) agree with the UTC instants the seed
    // fixture hard-codes, on any developer's machine.
    timezoneId: "UTC",
    locale: "en-GB",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: [
    {
      // `2>&1 | tee` is load-bearing, not cosmetic: Playwright pipes a
      // `webServer`'s output to the runner's own stdout and exposes no
      // programmatic handle on it, so the magic-link line has to land
      // somewhere `e2e/fixtures/auth.ts` can read. `tee` truncates on open,
      // so each run starts from an empty log.
      command: `mkdir -p "${path.join(ROOT, "test-results")}" && npm run start --workspace=backend 2>&1 | tee "${path.join(ROOT, "test-results", "backend.log")}"`,
      cwd: ROOT,
      url: "http://localhost:3000/health",
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      // `--port 5173 --strictPort` on the CLI rather than in
      // `frontend/vite.config.ts`, which sets neither and therefore rolls to
      // 5174 when 5173 is taken — silently pointing the whole suite at a
      // server that is not the one under test. Failing loudly is the point.
      command: "npm run dev --workspace=frontend -- --port 5173 --strictPort",
      cwd: ROOT,
      url: FRONTEND_ORIGIN,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
