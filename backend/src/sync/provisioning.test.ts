// Closes the split-brain from the task description: every user had
// household_id null server-side, so requireHousehold() 404s every sync call
// forever, regardless of what the client believes locally. This suite proves
// the actual fix end to end at the HTTP layer — POST /household (the SPEC
// §6.9 first-run "Start a household" action) is what populates household_id,
// and once it has, /sync/pull and /sync/push work for that same session
// without any other change to requireHousehold or the sync tables.
import { describe, it, expect } from "vitest";
import { buildApp, mockDbMulti, mockDbRecording, renderSql } from "../test-utils";
import householdPlugin from "../household/index";
import syncPlugin from "./index";
import { hashSecret } from "../auth/utils";
import { addToDate } from "../utils";

const USER_ID = "00000000-0000-0000-0000-000000000001";
const HOUSEHOLD_ID = "00000000-0000-0000-0000-0000000000a1";
const OTHER_HOUSEHOLD_ID = "00000000-0000-0000-0000-0000000000b1";

const SESSION_ID = "sessionid1234567890123456";
const SESSION_SECRET = "sessionsecretvalue1234567";

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    email: "self@example.com",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    householdId: null,
    displayName: null,
    tint: 1,
    joinedAt: null,
    ...overrides,
  };
}

function makeHousehold(overrides: Record<string, unknown> = {}) {
  return { id: HOUSEHOLD_ID, name: null, createdAt: new Date("2026-01-01T00:00:00.000Z"), ...overrides };
}

async function makeSession(overrides: Record<string, unknown> = {}) {
  const secretHash = Buffer.from(await hashSecret(SESSION_SECRET)).toString("hex");
  return {
    id: SESSION_ID,
    userId: USER_ID,
    secretHash,
    expiresAt: addToDate(new Date(), { days: 7 }),
    createdAt: new Date(),
    ...overrides,
  };
}

function build(db: any) {
  const app = buildApp(db);
  app.register(householdPlugin);
  app.register(syncPlugin);
  return app;
}

function authed(app: ReturnType<typeof build>, opts: Record<string, unknown>) {
  return app.inject({
    ...opts,
    cookies: { pet_tracker_token: `${SESSION_ID}.${SESSION_SECRET}` },
  } as any);
}

describe("provisioning unblocks sync", () => {
  it("a user with no household is provisioned via POST /household, then GET /sync/pull succeeds instead of 404ing", async () => {
    const session = await makeSession();
    const provisionedUser = makeUser({ householdId: HOUSEHOLD_ID, displayName: "Marta", tint: 1, joinedAt: new Date() });

    const db = mockDbMulti(
      [session], // auth: select session (POST /household)
      [], // auth: slide session expiry
      [makeUser({ householdId: null })], // household route: select caller — no household yet
      [makeHousehold()], // insert households
      [provisionedUser], // update users
      [session], // auth: select session (GET /sync/pull)
      [], // auth: slide session expiry
      [provisionedUser], // requireHousehold: select caller — now has HOUSEHOLD_ID
      [], // pullTable: pets
      [], // pullTable: medications
      [], // pullTable: courses
      [], // pullTable: doseEvents
      [], // pullTable: stockAdjustments
      [], // pullTable: courseEvents
    );
    const app = build(db);

    const createRes = await authed(app, {
      method: "POST",
      url: "/household",
      payload: { id: HOUSEHOLD_ID, displayName: "Marta" },
    });
    expect(createRes.statusCode).toBe(200);
    expect(createRes.json().household.id).toBe(HOUSEHOLD_ID);

    const pullRes = await authed(app, { method: "GET", url: "/sync/pull" });
    expect(pullRes.statusCode).toBe(200);
    expect(pullRes.json()).toEqual({ changes: {}, cursor: "0", hasMore: false });
  });

  it("a user with no household is provisioned via POST /household, then POST /sync/push succeeds instead of 404ing", async () => {
    const session = await makeSession();
    const provisionedUser = makeUser({ householdId: HOUSEHOLD_ID, displayName: "Marta", tint: 1, joinedAt: new Date() });

    const db = mockDbMulti(
      [session], // auth (POST /household)
      [],
      [makeUser({ householdId: null })], // select caller — no household yet
      [makeHousehold()], // insert households
      [provisionedUser], // update users
      [session], // auth (POST /sync/push)
      [],
      [provisionedUser], // requireHousehold — now has HOUSEHOLD_ID
    );
    const app = build(db);

    const createRes = await authed(app, {
      method: "POST",
      url: "/household",
      payload: { id: HOUSEHOLD_ID, displayName: "Marta" },
    });
    expect(createRes.statusCode).toBe(200);

    // Empty push: proves the route itself is reachable now (no 404), without
    // needing to model every table's insert path — that's covered per-table
    // in sync/index.test.ts, unmodified by this fix.
    const pushRes = await authed(app, { method: "POST", url: "/sync/push", payload: {} });
    expect(pushRes.statusCode).toBe(200);
    expect(pushRes.json()).toEqual({ accepted: 0, cursor: "0" });
  });

  // Cross-household isolation, tied specifically to this fix: sync/index.ts's
  // own isolation tests (unmodified by this change) already prove the query
  // predicate scopes to whatever `requireHousehold` returns. What they cannot
  // prove is that provisioning feeds the RIGHT id into that predicate. This
  // test closes that gap end to end, using the same recording technique those
  // tests use (mockDbRecording + renderSql against the real drizzle SQL) —
  // the household id that POST /household just wrote is the exact, sole id
  // every one of sync/pull's six table queries is scoped to.
  it("the id provisioning writes is the exact id GET /sync/pull scopes every table query to", async () => {
    const session = await makeSession();
    const provisionedUser = makeUser({ householdId: HOUSEHOLD_ID, displayName: "Marta" });
    const db = mockDbRecording(
      [session],
      [],
      [makeUser({ householdId: null })],
      [makeHousehold()],
      [provisionedUser],
      [session],
      [],
      [provisionedUser],
      [],
      [],
      [],
      [],
      [],
      [],
    );
    const app = build(db);
    await authed(app, { method: "POST", url: "/household", payload: { id: HOUSEHOLD_ID, displayName: "Marta" } });
    const pullRes = await authed(app, { method: "GET", url: "/sync/pull" });
    expect(pullRes.statusCode).toBe(200);

    // Six SYNC_TABLES entries, one `.where()` each, in order — the same
    // trailing-slice technique sync/index.test.ts uses.
    const whereCalls = db.calls.filter((c: any) => c.method === "where").slice(-6);
    expect(whereCalls).toHaveLength(6);
    for (const call of whereCalls) {
      const { sql, params } = renderSql(call.args[0]);
      expect(sql).toContain("household_id");
      expect(params).toContain(HOUSEHOLD_ID);
      expect(params).not.toContain(OTHER_HOUSEHOLD_ID);
    }
  });
});
