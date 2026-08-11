import { describe, it, expect } from "vitest";
import { buildApp, mockDbMulti, mockDbRecording, renderSql } from "../test-utils";
import syncPlugin, { SYNC_TABLES } from "./index";
import { hashSecret } from "../auth/utils";
import { addToDate } from "../utils";
import { courseEvents, courses, doseEvents, medications, pets, stockAdjustments } from "../db/schema";

const USER_ID = "00000000-0000-0000-0000-000000000001";
const HOUSEHOLD_A = "00000000-0000-0000-0000-0000000000a1";
const HOUSEHOLD_B = "00000000-0000-0000-0000-0000000000b1";

const SESSION_SECRET = "sessionsecretvalue1234567";
const SESSION_ID = "sessionid1234567890123456";

const NOW = "2026-01-01T00:00:00.000Z";
const LATER = "2026-01-02T00:00:00.000Z";

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    email: "self@example.com",
    createdAt: new Date(NOW),
    householdId: HOUSEHOLD_A,
    displayName: "Marta",
    tint: 1,
    joinedAt: new Date(NOW),
    ...overrides,
  };
}

async function buildSession(overrides: Record<string, unknown> = {}) {
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
  app.register(syncPlugin);
  return app;
}

function authed(app: ReturnType<typeof build>, opts: Record<string, unknown>) {
  return app.inject({
    ...opts,
    cookies: { pet_tracker_token: `${SESSION_ID}.${SESSION_SECRET}` },
  } as any);
}

// --------------------------------------------------------------------------
// One spec per sync table, in the SAME order as SYNC_TABLES in sync/index.ts.
// Table-driven so a seventh table added there cannot silently skip its
// isolation test here — add one entry and the `describe.each` below covers it.
// --------------------------------------------------------------------------

interface TableSpec {
  key: string;
  table: any;
  syncKind: "mutable" | "ledger";
  dto: (overrides?: Record<string, unknown>) => Record<string, unknown>;
  row: (householdId: string, overrides?: Record<string, unknown>) => Record<string, unknown>;
}

const TABLE_SPECS: TableSpec[] = [
  {
    key: "pets",
    table: pets,
    syncKind: "mutable",
    dto: (overrides = {}) => ({
      id: "10000000-0000-0000-0000-000000000001",
      name: "Clover",
      species: "rabbit",
      birthdate: null,
      weightGrams: null,
      tint: 1,
      archived: false,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
      ...overrides,
    }),
    row: (householdId, overrides = {}) => ({
      id: "10000000-0000-0000-0000-000000000001",
      householdId,
      syncSeq: 1,
      name: "Clover",
      species: "rabbit",
      birthdate: null,
      weightGrams: null,
      tint: 1,
      archived: false,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
      deletedAt: null,
      ...overrides,
    }),
  },
  {
    key: "medications",
    table: medications,
    syncKind: "mutable",
    dto: (overrides = {}) => ({
      id: "20000000-0000-0000-0000-000000000001",
      name: "Metacam",
      strength: "0.5 mg/ml",
      form: "liquid",
      unit: "ml",
      packSize: 15,
      stockUnits: 10,
      lowThreshold: null,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
      ...overrides,
    }),
    row: (householdId, overrides = {}) => ({
      id: "20000000-0000-0000-0000-000000000001",
      householdId,
      syncSeq: 1,
      name: "Metacam",
      strength: "0.5 mg/ml",
      form: "liquid",
      unit: "ml",
      packSize: 15,
      stockUnits: 10,
      lowThreshold: null,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
      deletedAt: null,
      ...overrides,
    }),
  },
  {
    key: "courses",
    table: courses,
    syncKind: "mutable",
    dto: (overrides = {}) => ({
      id: "30000000-0000-0000-0000-000000000001",
      petId: "10000000-0000-0000-0000-000000000001",
      medicationId: "20000000-0000-0000-0000-000000000001",
      doseAmount: 0.4,
      doseUnit: "ml",
      instructions: null,
      schedule: { kind: "fixedTimes", times: ["08:00"] },
      startDate: "2026-01-01",
      endDate: null,
      status: "active",
      notes: null,
      resumedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
      ...overrides,
    }),
    row: (householdId, overrides = {}) => ({
      id: "30000000-0000-0000-0000-000000000001",
      householdId,
      syncSeq: 1,
      petId: "10000000-0000-0000-0000-000000000001",
      medicationId: "20000000-0000-0000-0000-000000000001",
      doseAmount: 0.4,
      doseUnit: "ml",
      instructions: null,
      schedule: { kind: "fixedTimes", times: ["08:00"] },
      startDate: "2026-01-01",
      endDate: null,
      status: "active",
      notes: null,
      resumedAt: null,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
      deletedAt: null,
      ...overrides,
    }),
  },
  {
    key: "doseEvents",
    table: doseEvents,
    syncKind: "ledger",
    dto: (overrides = {}) => ({
      id: "40000000-0000-0000-0000-000000000001",
      courseId: "30000000-0000-0000-0000-000000000001",
      scheduledFor: NOW,
      status: "given",
      loggedAt: NOW,
      givenAt: NOW,
      amount: 0.4,
      note: null,
      occurrenceKey: "30000000-0000-0000-0000-000000000001|2026-01-01T08:00:00.000Z",
      supersedesId: null,
      actorId: USER_ID,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
      ...overrides,
    }),
    row: (householdId, overrides = {}) => ({
      id: "40000000-0000-0000-0000-000000000001",
      householdId,
      syncSeq: 1,
      courseId: "30000000-0000-0000-0000-000000000001",
      scheduledFor: new Date(NOW),
      status: "given",
      loggedAt: new Date(NOW),
      givenAt: new Date(NOW),
      amount: 0.4,
      note: null,
      occurrenceKey: "30000000-0000-0000-0000-000000000001|2026-01-01T08:00:00.000Z",
      supersedesId: null,
      actorId: USER_ID,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
      deletedAt: null,
      ...overrides,
    }),
  },
  {
    key: "stockAdjustments",
    table: stockAdjustments,
    syncKind: "ledger",
    dto: (overrides = {}) => ({
      id: "50000000-0000-0000-0000-000000000001",
      medicationId: "20000000-0000-0000-0000-000000000001",
      deltaUnits: 15,
      reason: "purchase",
      note: null,
      actorId: USER_ID,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
      ...overrides,
    }),
    row: (householdId, overrides = {}) => ({
      id: "50000000-0000-0000-0000-000000000001",
      householdId,
      syncSeq: 1,
      medicationId: "20000000-0000-0000-0000-000000000001",
      deltaUnits: 15,
      reason: "purchase",
      note: null,
      actorId: USER_ID,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
      deletedAt: null,
      ...overrides,
    }),
  },
  {
    key: "courseEvents",
    table: courseEvents,
    syncKind: "ledger",
    dto: (overrides = {}) => ({
      id: "60000000-0000-0000-0000-000000000001",
      courseId: "30000000-0000-0000-0000-000000000001",
      kind: "started",
      at: NOW,
      actorId: USER_ID,
      before: null,
      after: {
        schedule: { kind: "fixedTimes", times: ["08:00"] },
        doseAmount: 0.4,
        doseUnit: "ml",
        startDate: "2026-01-01",
        endDate: null,
      },
      seq: 1,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
      ...overrides,
    }),
    row: (householdId, overrides = {}) => ({
      id: "60000000-0000-0000-0000-000000000001",
      householdId,
      syncSeq: 1,
      courseId: "30000000-0000-0000-0000-000000000001",
      kind: "started",
      at: new Date(NOW),
      actorId: USER_ID,
      before: null,
      after: {
        schedule: { kind: "fixedTimes", times: ["08:00"] },
        doseAmount: 0.4,
        doseUnit: "ml",
        startDate: "2026-01-01",
        endDate: null,
      },
      seq: 1,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
      deletedAt: null,
      ...overrides,
    }),
  },
];

// TABLE_SPECS above is a hand-maintained mirror of SYNC_TABLES in
// sync/index.ts. Without this assertion, a table added to SYNC_TABLES but
// forgotten here would ship with zero cross-household isolation coverage —
// the describe.each block below only ever sees what's listed in TABLE_SPECS.
it("TABLE_SPECS covers exactly the same tables as SYNC_TABLES", () => {
  const specKeys = TABLE_SPECS.map((s) => s.key).sort();
  const sourceKeys = SYNC_TABLES.map((t) => t.key).sort();
  expect(specKeys).toEqual(sourceKeys);
});

describe("auth and household gates", () => {
  it("401s POST /sync/push when unauthenticated", async () => {
    const app = build(mockDbMulti());
    const res = await app.inject({ method: "POST", url: "/sync/push", payload: { changes: {} } });
    expect(res.statusCode).toBe(401);
  });

  it("401s GET /sync/pull when unauthenticated", async () => {
    const app = build(mockDbMulti());
    const res = await app.inject({ method: "GET", url: "/sync/pull" });
    expect(res.statusCode).toBe(401);
  });

  it("404s POST /sync/push when the caller has no household", async () => {
    const db = mockDbMulti([await buildSession()], [], [makeUser({ householdId: null })]);
    const app = build(db);
    const res = await authed(app, { method: "POST", url: "/sync/push", payload: { changes: {} } });
    expect(res.statusCode).toBe(404);
  });

  it("404s GET /sync/pull when the caller has no household", async () => {
    const db = mockDbMulti([await buildSession()], [], [makeUser({ householdId: null })]);
    const app = build(db);
    const res = await authed(app, { method: "GET", url: "/sync/pull" });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /sync/push", () => {
  it("ignores a householdId supplied in the body, stamping the session's household instead", async () => {
    const petSpec = TABLE_SPECS[0];
    const db = mockDbRecording([await buildSession()], [], [makeUser({ householdId: HOUSEHOLD_A })], [{ syncSeq: 2 }]);
    const app = build(db);
    const res = await authed(app, {
      method: "POST",
      url: "/sync/push",
      payload: {
        householdId: HOUSEHOLD_B,
        changes: { pets: [{ ...petSpec.dto(), householdId: HOUSEHOLD_B }] },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(1);

    const valuesCall = db.calls.find((c: any) => c.method === "values");
    expect(valuesCall).toBeDefined();
    const insertedRow = valuesCall!.args[0] as any[];
    expect(insertedRow[0].householdId).toBe(HOUSEHOLD_A);
    expect(insertedRow[0].householdId).not.toBe(HOUSEHOLD_B);
  });

  it("LWW: a stale updatedAt does not clobber a newer row (guard fails, DB returns nothing)", async () => {
    const petSpec = TABLE_SPECS[0];
    // Simulates Postgres skipping the update because `excluded.updated_at >
    // table.updated_at` was false — no row comes back from RETURNING.
    const db = mockDbRecording([await buildSession()], [], [makeUser()], []);
    const app = build(db);
    const res = await authed(app, {
      method: "POST",
      url: "/sync/push",
      payload: { changes: { pets: [petSpec.dto({ updatedAt: NOW })] } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(0);
    expect(res.json().cursor).toBe("0");

    const conflictCall = db.calls.find((c: any) => c.method === "onConflictDoUpdate");
    const { sql } = renderSql(conflictCall!.args[0].setWhere);
    expect(sql).toContain("excluded.updated_at");
    expect(sql).toContain("updated_at");
  });

  it("LWW: a newer updatedAt wins (guard passes, DB returns the updated row)", async () => {
    const petSpec = TABLE_SPECS[0];
    const db = mockDbRecording([await buildSession()], [], [makeUser()], [{ syncSeq: 9 }]);
    const app = build(db);
    const res = await authed(app, {
      method: "POST",
      url: "/sync/push",
      payload: { changes: { pets: [petSpec.dto({ updatedAt: LATER })] } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(1);
    expect(res.json().cursor).toBe("9");
  });

  it("ledger rows are never overwritten, even resent under the same household", async () => {
    const doseSpec = TABLE_SPECS.find((s) => s.key === "doseEvents")!;
    // Simulates the id already existing: ON CONFLICT DO NOTHING returns no row.
    const db = mockDbRecording([await buildSession()], [], [makeUser()], []);
    const app = build(db);
    const res = await authed(app, {
      method: "POST",
      url: "/sync/push",
      payload: { changes: { doseEvents: [doseSpec.dto()] } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(0);

    const conflictCall = db.calls.find((c: any) => c.method === "onConflictDoNothing");
    expect(conflictCall).toBeDefined();
    // No config passed at all — there is no update path, guarded or otherwise,
    // through which an existing ledger row could ever be changed.
    expect(conflictCall!.args).toHaveLength(0);
  });

  it("stamps a ledger row's actorId from the authenticated session, ignoring whatever the client supplied", async () => {
    // The identity-mismatch fix's other half: the client used to control
    // `actorId` outright, so any authenticated caller could attribute a
    // dose to an arbitrary id — including one belonging to nobody, or to
    // another household's member entirely. Every push is authenticated as
    // exactly the device pushing its own previously-created rows, so the
    // session's own id is always the correct attribution regardless of
    // what the row was stamped with client-side.
    const doseSpec = TABLE_SPECS.find((s) => s.key === "doseEvents")!;
    const IMPOSTOR_ACTOR_ID = "99999999-0000-0000-0000-000000000099";
    const db = mockDbRecording([await buildSession()], [], [makeUser({ householdId: HOUSEHOLD_A })], [{ syncSeq: 4 }]);
    const app = build(db);
    const res = await authed(app, {
      method: "POST",
      url: "/sync/push",
      payload: { changes: { doseEvents: [doseSpec.dto({ actorId: IMPOSTOR_ACTOR_ID })] } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(1);

    const valuesCall = db.calls.find((c: any) => c.method === "values");
    const insertedRow = valuesCall!.args[0] as any[];
    expect(insertedRow[0].actorId).toBe(USER_ID);
    expect(insertedRow[0].actorId).not.toBe(IMPOSTOR_ACTOR_ID);
  });

  it("stamps actorId from the session even when the impersonated id names a real member of a DIFFERENT household — cross-household attribution isolation", async () => {
    const doseSpec = TABLE_SPECS.find((s) => s.key === "doseEvents")!;
    const HOUSEHOLD_B_MEMBER_ID = "88888888-0000-0000-0000-000000000088";
    // The caller is a member of household A; the payload tries to attribute
    // the dose to someone else's (household B's) account id entirely.
    const db = mockDbRecording([await buildSession()], [], [makeUser({ householdId: HOUSEHOLD_A })], [{ syncSeq: 1 }]);
    const app = build(db);
    const res = await authed(app, {
      method: "POST",
      url: "/sync/push",
      payload: { changes: { doseEvents: [doseSpec.dto({ actorId: HOUSEHOLD_B_MEMBER_ID })] } },
    });
    expect(res.statusCode).toBe(200);

    const valuesCall = db.calls.find((c: any) => c.method === "values");
    const insertedRow = valuesCall!.args[0] as any[];
    // Written under the caller's own household (already covered by the
    // householdId test above) AND the caller's own session id — never the
    // household-B id the payload tried to smuggle in.
    expect(insertedRow[0].householdId).toBe(HOUSEHOLD_A);
    expect(insertedRow[0].actorId).toBe(USER_ID);
    expect(insertedRow[0].actorId).not.toBe(HOUSEHOLD_B_MEMBER_ID);
  });

  it("leaves mutable-table rows (no actorId column) untouched by the stamping logic", async () => {
    const petSpec = TABLE_SPECS[0];
    const db = mockDbRecording([await buildSession()], [], [makeUser()], [{ syncSeq: 1 }]);
    const app = build(db);
    const res = await authed(app, {
      method: "POST",
      url: "/sync/push",
      payload: { changes: { pets: [petSpec.dto()] } },
    });
    expect(res.statusCode).toBe(200);
    const valuesCall = db.calls.find((c: any) => c.method === "values");
    const insertedRow = valuesCall!.args[0] as any[];
    expect(insertedRow[0].actorId).toBeUndefined();
  });

  it("commits every table's batch inside one transaction", async () => {
    const petSpec = TABLE_SPECS[0];
    const medSpec = TABLE_SPECS[1];
    const db = mockDbRecording(
      [await buildSession()],
      [],
      [makeUser()],
      [{ syncSeq: 2 }],
      [{ syncSeq: 3 }],
    );
    const app = build(db);
    const res = await authed(app, {
      method: "POST",
      url: "/sync/push",
      payload: { changes: { pets: [petSpec.dto()], medications: [medSpec.dto()] } },
    });
    expect(res.statusCode).toBe(200);
    expect(db.transactions).toBe(1);
    expect(res.json().accepted).toBe(2);
    expect(res.json().cursor).toBe("3");
  });
});

describe("GET /sync/pull", () => {
  function pullDb(rowsPerTable: unknown[][], sessionOverrides: Record<string, unknown> = {}) {
    return mockDbRecording([sessionRow], [], [makeUser(sessionOverrides)], ...rowsPerTable);
  }

  let sessionRow: Awaited<ReturnType<typeof buildSession>>;

  it("advances the cursor to the max sync_seq returned, hasMore false when nothing truncates", async () => {
    sessionRow = await buildSession();
    const petSpec = TABLE_SPECS[0];
    const rows = TABLE_SPECS.map((s) => (s.key === "pets" ? [s.row(HOUSEHOLD_A, { syncSeq: 5 }), s.row(HOUSEHOLD_A, { syncSeq: 7 })] : []));
    const db = pullDb(rows);
    const app = build(db);
    const res = await authed(app, { method: "GET", url: "/sync/pull" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cursor).toBe("7");
    expect(body.hasMore).toBe(false);
    expect(body.changes.pets).toHaveLength(2);
    void petSpec;
  });

  it("sets hasMore and advances only to the truncated table's max when a table hits the page limit", async () => {
    sessionRow = await buildSession();
    const petSpec = TABLE_SPECS[0];
    const medSpec = TABLE_SPECS[1];
    const truncatedRows = Array.from({ length: 500 }, (_, i) => petSpec.row(HOUSEHOLD_A, { id: `pet-${i}`, syncSeq: i + 1 }));
    const untruncatedRows = [medSpec.row(HOUSEHOLD_A, { syncSeq: 900 })];
    const rows = TABLE_SPECS.map((s) => {
      if (s.key === "pets") return truncatedRows;
      if (s.key === "medications") return untruncatedRows;
      return [];
    });
    const db = pullDb(rows);
    const app = build(db);
    const res = await authed(app, { method: "GET", url: "/sync/pull" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.hasMore).toBe(true);
    // Only the truncated table's max counts — the untruncated table's higher
    // watermark (900) must NOT leak into the cursor, or its still-unread rows
    // between 500 and 900 would be skipped on the next page.
    expect(body.cursor).toBe("500");
  });

  it("leaves the cursor at the incoming value when nothing is returned", async () => {
    sessionRow = await buildSession();
    const rows = TABLE_SPECS.map(() => []);
    const db = pullDb(rows);
    const app = build(db);
    const res = await authed(app, { method: "GET", url: "/sync/pull?cursor=42" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cursor).toBe("42");
    expect(body.hasMore).toBe(false);
    expect(body.changes).toEqual({});
  });

  it("maps a DB row back to the wire DTO shape (ISO instants, no leaked household_id)", async () => {
    sessionRow = await buildSession();
    const rows = TABLE_SPECS.map((s) => (s.key === "pets" ? [s.row(HOUSEHOLD_A, { syncSeq: 3 })] : []));
    const db = pullDb(rows);
    const app = build(db);
    const res = await authed(app, { method: "GET", url: "/sync/pull" });
    const [pet] = res.json().changes.pets;
    expect(pet).toEqual({
      id: "10000000-0000-0000-0000-000000000001",
      name: "Clover",
      species: "rabbit",
      birthdate: null,
      weightGrams: null,
      tint: 1,
      archived: false,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    });
    expect(pet.householdId).toBeUndefined();
  });
});

describe.each(TABLE_SPECS)("cross-household isolation: $key", (spec) => {
  it("push cannot overwrite household B's row by supplying its id", async () => {
    // Simulates the real guard: the target row belongs to household B, so
    // Postgres either leaves it untouched (mutable, setWhere false) or the
    // conflicting id is simply never a candidate for update at all (ledger).
    const db = mockDbRecording([await buildSession()], [], [makeUser({ householdId: HOUSEHOLD_A })], []);
    const app = build(db);
    const res = await authed(app, {
      method: "POST",
      url: "/sync/push",
      payload: { changes: { [spec.key]: [spec.dto()] } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(0);

    const valuesCall = db.calls.find((c: any) => c.method === "values");
    const insertedRow = valuesCall!.args[0] as any[];
    // The row is always stamped with the CALLER's household — there is no DTO
    // field through which a household id can even be supplied.
    expect(insertedRow[0].householdId).toBe(HOUSEHOLD_A);

    if (spec.syncKind === "mutable") {
      const conflictCall = db.calls.find((c: any) => c.method === "onConflictDoUpdate");
      expect(conflictCall).toBeDefined();
      const { sql, params } = renderSql(conflictCall!.args[0].setWhere);
      expect(sql).toContain("household_id");
      expect(params).toContain(HOUSEHOLD_A);
      expect(params).not.toContain(HOUSEHOLD_B);
    } else {
      const conflictCall = db.calls.find((c: any) => c.method === "onConflictDoNothing");
      expect(conflictCall).toBeDefined();
      // Ledger conflicts take no config at all: no update path exists through
      // which any household — including the caller's own — could overwrite
      // an existing row.
      expect(conflictCall!.args).toHaveLength(0);
    }
  });

  it("pull cannot return household B's rows: the query is scoped to the caller's household", async () => {
    const idx = TABLE_SPECS.findIndex((s) => s.key === spec.key);
    const rowsPerTable = TABLE_SPECS.map((s, i) => (i === idx ? [s.row(HOUSEHOLD_A)] : []));
    const db = mockDbRecording([await buildSession()], [], [makeUser({ householdId: HOUSEHOLD_A })], ...rowsPerTable);
    const app = build(db);
    const res = await authed(app, { method: "GET", url: "/sync/pull" });
    expect(res.statusCode).toBe(200);
    expect(res.json().changes[spec.key]).toHaveLength(1);

    // The auth plugin and requireHousehold also issue `.where()` calls before
    // the six table pulls (session lookup, session slide-expiry, user lookup),
    // and `pullRoster`'s household-roster query issues one more AFTER them —
    // take only the six in between, one per SYNC_TABLES entry in order.
    const whereCalls = db.calls
      .filter((c: any) => c.method === "where")
      .slice(-TABLE_SPECS.length - 1, -1);
    expect(whereCalls).toHaveLength(TABLE_SPECS.length);
    const relevantWhere = whereCalls[idx];
    const { sql, params } = renderSql(relevantWhere.args[0]);
    expect(sql).toContain("household_id");
    expect(params).toContain(HOUSEHOLD_A);
    expect(params).not.toContain(HOUSEHOLD_B);
  });
});

// --------------------------------------------------------------------------
// `pullRoster` — the household roster `GET /sync/pull` attaches to
// `changes.users` (see that function's comment in `sync/index.ts` for why
// this is a separate, uncursored side channel rather than an eighth
// TABLE_SPECS entry). The reported defect: a device that never opens the
// Household screen never learns any OTHER member's name at all, so a dose
// they logged renders "Someone" forever instead of their real name.
// --------------------------------------------------------------------------

const MARTA_ID = "00000000-0000-0000-0000-0000000000c2";

function marta(overrides: Record<string, unknown> = {}) {
  return {
    id: MARTA_ID,
    email: "marta@example.com",
    createdAt: new Date(NOW),
    householdId: HOUSEHOLD_A,
    displayName: "Marta",
    tint: 2,
    joinedAt: new Date(NOW),
    ...overrides,
  };
}

// NOT async, and never awaited by a caller: `mockDbRecording`'s chain is
// itself a thenable (it implements `.then` to serve queued results), so
// returning it from an `async function` — or `await`-ing this helper's
// result — would let the JS Promise machinery treat the chain as something
// TO resolve, silently unwrapping it into its first queued result instead of
// the chain object callers actually need. `sessionRow` is resolved by the
// caller first (`buildSession()` IS genuinely async — it hashes a secret) and
// passed in already-settled, matching `pullDb`'s pattern above.
function pullDbWithRoster(
  sessionRow: unknown,
  rosterRows: unknown[],
  sessionOverrides: Record<string, unknown> = {},
) {
  const emptyTableRows = TABLE_SPECS.map(() => []);
  return mockDbRecording([sessionRow], [], [makeUser(sessionOverrides)], ...emptyTableRows, rosterRows);
}

describe("GET /sync/pull — household roster (pullRoster)", () => {
  it("attaches the caller's OTHER members to changes.users, excluding the caller's own row", async () => {
    const sessionRow = await buildSession();
    const db = pullDbWithRoster(sessionRow, [marta()], { householdId: HOUSEHOLD_A });
    const app = build(db);
    const res = await authed(app, { method: "GET", url: "/sync/pull" });
    expect(res.statusCode).toBe(200);
    expect(res.json().changes.users).toEqual([
      { id: MARTA_ID, householdId: HOUSEHOLD_A, displayName: "Marta", tint: 2, joinedAt: NOW, aliasIds: [] },
    ]);
  });

  it("omits changes.users entirely when the caller has no other members", async () => {
    const sessionRow = await buildSession();
    const db = pullDbWithRoster(sessionRow, [], { householdId: HOUSEHOLD_A });
    const app = build(db);
    const res = await authed(app, { method: "GET", url: "/sync/pull" });
    expect(res.statusCode).toBe(200);
    expect(res.json().changes.users).toBeUndefined();
  });

  it("tenant isolation: the roster query is scoped to the caller's own household and excludes the caller, never a client-supplied id", async () => {
    const sessionRow = await buildSession();
    const db = pullDbWithRoster(sessionRow, [marta()], { householdId: HOUSEHOLD_A });
    const app = build(db);
    const res = await authed(app, { method: "GET", url: "/sync/pull" });
    expect(res.statusCode).toBe(200);

    // The trailing `.where()` call is `pullRoster`'s — everything else in
    // this route is asserted by the `describe.each(TABLE_SPECS)` block above.
    const whereCalls = db.calls.filter((c: any) => c.method === "where");
    const rosterWhere = whereCalls[whereCalls.length - 1];
    const { sql, params } = renderSql(rosterWhere.args[0]);
    expect(sql).toContain("household_id");
    // Scoped to the caller's OWN session-derived household — HOUSEHOLD_A —
    // never HOUSEHOLD_B, and there is no request field through which a
    // caller could supply a different household id at all.
    expect(params).toContain(HOUSEHOLD_A);
    expect(params).not.toContain(HOUSEHOLD_B);
    // And the caller's own id is excluded server-side (from `request.userId`,
    // the authenticated session), never left for the client to filter.
    expect(params).toContain(USER_ID);
  });
});
