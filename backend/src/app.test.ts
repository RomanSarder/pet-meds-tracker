import { describe, it, expect, afterEach } from "vitest";
import Fastify from "fastify";
import app from "./app";

// This is the one test in the suite that boots the REAL composed app.ts
// graph (auth -> household -> sync, each of which independently registers
// authenticate-plugin). Every other backend test registers a single feature
// plugin in isolation via test-utils#buildApp, which is exactly why three
// merged slices were each able to ship registering authenticate-plugin a
// second and third time without any test noticing that the composed app
// couldn't boot (FST_ERR_DEC_ALREADY_PRESENT on the "userId" request
// decorator). Do not "simplify" this into hand-registering a subset of
// plugins — that recreates the blind spot this test exists to close.
describe("app composition boots", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("becomes ready and serves GET /health", async () => {
    // Supplied directly so the test is hermetic regardless of whether a local
    // .env is present; @fastify/env's dotenv loading never overrides env vars
    // that are already set.
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/pet_tracker_test";
    process.env.NODE_ENV = "test";
    process.env.FRONTEND_URL = "http://localhost:5173";
    process.env.FRONTEND_PUBLIC_URL = "http://localhost:5173";

    const fastify = Fastify();
    fastify.register(app);

    // No live Postgres is required: drizzle-orm/postgres-js's client connects
    // lazily on first query, and this test never issues one — it only proves
    // the plugin graph itself composes and reaches ready.
    await fastify.ready();

    const res = await fastify.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });

    await fastify.close();
  });
});
