import Fastify, { FastifyInstance } from "fastify";
import sensible from "@fastify/sensible";
import cookie from "@fastify/cookie";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

// Purely additive vs. the original list: `onConflictDoUpdate` is needed by
// sync's LWW upsert (backend/src/sync/index.ts). Adding a working passthrough
// method does not change how any existing test's mockDb/mockDbMulti chain
// behaves — nothing before this slice ever called it.
const DB_METHODS = [
  "select", "insert", "update", "delete",
  "from", "where", "values", "set", "orderBy",
  "returning", "onConflictDoNothing", "onConflictDoUpdate",
  "innerJoin", "leftJoin",
  "groupBy", "limit", "offset",
];

export function mockDb(result: unknown) {
  const chain: Record<string, unknown> = {};
  for (const m of DB_METHODS) {
    chain[m] = () => chain;
  }
  (chain as any).then = (res: any, rej?: any) =>
    Promise.resolve(result).then(res, rej);
  (chain as any).catch = (rej: any) => Promise.resolve(result).catch(rej);
  return chain as any;
}

export function mockDbMulti(...results: unknown[]) {
  let i = 0;
  const chain: any = {};
  for (const m of DB_METHODS) {
    chain[m] = () => chain;
  }
  chain.then = (res: any, rej?: any) => {
    const result = results[i++] ?? [];
    if (result instanceof Error) {
      return Promise.reject(result).then(res, rej);
    }
    return Promise.resolve(result).then(res, rej);
  };
  // Runs the callback against the same chain, so statements inside a transaction
  // consume the same ordered result list as statements outside one. `transactions`
  // counts the calls, which is how a test asserts that a multi-statement invariant
  // (SPEC §5's one-live-join-code) was actually wrapped rather than left racy.
  chain.transactions = 0;
  chain.transaction = (fn: (tx: any) => Promise<unknown>) => {
    chain.transactions++;
    return fn(chain);
  };
  return chain;
}

export interface RecordedCall {
  method: string;
  args: unknown[];
}

/**
 * Like `mockDbMulti`, but also records every method call made against the
 * chain, in call order, with its raw arguments.
 *
 * `mockDbMulti` alone cannot prove household scoping: it returns canned rows
 * regardless of what query produced them, so a test built only on its results
 * would pass even if a route forgot the `household_id` predicate entirely.
 * Sync's cross-household isolation tests (backend/src/sync/index.test.ts)
 * instead pull the REAL drizzle `SQL`/condition objects out of `.calls` and
 * render them with `renderSql` below, so the assertion is against the actual
 * generated predicate rather than the mock's stand-in return value.
 */
export function mockDbRecording(...results: unknown[]) {
  let i = 0;
  const calls: RecordedCall[] = [];
  const chain: any = {};
  for (const m of DB_METHODS) {
    chain[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return chain;
    };
  }
  chain.then = (res: any, rej?: any) => {
    const result = results[i++] ?? [];
    if (result instanceof Error) {
      return Promise.reject(result).then(res, rej);
    }
    return Promise.resolve(result).then(res, rej);
  };
  chain.transactions = 0;
  chain.transaction = (fn: (tx: any) => Promise<unknown>) => {
    chain.transactions++;
    return fn(chain);
  };
  chain.calls = calls;
  return chain;
}

/**
 * Renders a drizzle `SQL` fragment (e.g. an `eq(...)`/`and(...)` condition
 * captured from a recorded `.where()` or `onConflictDoUpdate({ setWhere })`
 * call) to real parameterized SQL text and params, via drizzle's own Postgres
 * dialect — the same rendering a live query would receive. This is what turns
 * "we captured *something*" into "we captured a predicate that actually
 * scopes to this household".
 */
export function renderSql(fragment: unknown): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(fragment as SQL);
}

export function buildApp(db: any): FastifyInstance {
  const app = Fastify();
  app.register(sensible);
  app.register(cookie);
  app.decorate("db", db);
  app.decorate("config", {
    DATABASE_URL: "postgres://localhost/test",
    NODE_ENV: "test" as const,
    FRONTEND_URL: "http://localhost:5173",
    FRONTEND_PUBLIC_URL: "http://localhost:5173",
  });
  return app;
}
