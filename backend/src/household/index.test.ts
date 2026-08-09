import { describe, it, expect, vi } from "vitest";
import { buildApp, mockDbMulti } from "../test-utils";
import householdPlugin from "./index";
import { hashSecret } from "../auth/utils";
import { addToDate } from "../utils";
import { households, joinCodes, users } from "../db/schema";

const USER_ID = "00000000-0000-0000-0000-000000000001";
const OTHER_ID = "00000000-0000-0000-0000-000000000002";
const HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000010";
const CODE_ID = "00000000-0000-0000-0000-000000000020";

const SESSION_SECRET = "sessionsecretvalue1234567";
const SESSION_ID = "sessionid1234567890123456";

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    email: "self@example.com",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    householdId: HOUSEHOLD_ID,
    displayName: "Marta",
    tint: 1,
    joinedAt: new Date("2026-01-02T00:00:00.000Z"),
    ...overrides,
  };
}

function makeHousehold(overrides: Record<string, unknown> = {}) {
  return {
    id: HOUSEHOLD_ID,
    name: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function makeJoinCode(overrides: Record<string, unknown> = {}) {
  return {
    id: CODE_ID,
    householdId: HOUSEHOLD_ID,
    code: "ABCDEF",
    createdBy: USER_ID,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
    usedBy: null,
    revokedAt: null,
    createdAt: new Date(),
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
  app.register(householdPlugin);
  return app;
}

function authed(app: ReturnType<typeof build>, opts: Record<string, unknown>) {
  return app.inject({
    ...opts,
    cookies: { pet_tracker_token: `${SESSION_ID}.${SESSION_SECRET}` },
  } as any);
}

describe("GET /household", () => {
  it("404s when the caller has no household", async () => {
    const db = mockDbMulti([await buildSession()], [], [makeUser({ householdId: null })]);
    const app = build(db);
    const res = await authed(app, { method: "GET", url: "/household" });
    expect(res.statusCode).toBe(404);
  });

  it("returns the household, its members, and self", async () => {
    const self = makeUser();
    const other = makeUser({ id: OTHER_ID, displayName: "Ilya", tint: 2 });
    const household = makeHousehold({ name: "Home" });
    const db = mockDbMulti([await buildSession()], [], [self], [household], [self, other]);
    const app = build(db);
    const res = await authed(app, { method: "GET", url: "/household" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.household).toEqual({ id: household.id, name: "Home", createdAt: household.createdAt.toISOString() });
    expect(body.members).toHaveLength(2);
    expect(body.self.id).toBe(self.id);
    expect(body.self.email).toBe(self.email);
  });
});

describe("POST /household", () => {
  it("creates a household, makes the caller a member, and sets the display name", async () => {
    const household = makeHousehold({ name: null });
    const user = makeUser({ householdId: household.id, displayName: "Roman", tint: 1 });
    const db = mockDbMulti([await buildSession()], [], [household], [user]);
    const app = build(db);
    const res = await authed(app, {
      method: "POST",
      url: "/household",
      payload: { displayName: "Roman" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.household.id).toBe(household.id);
    expect(body.members).toHaveLength(1);
    expect(body.self.displayName).toBe("Roman");
    expect(body.self.tint).toBe(1);
  });
});

describe("PATCH /household/me", () => {
  it("400s for a blank name", async () => {
    const db = mockDbMulti([await buildSession()], []);
    const app = build(db);
    const res = await authed(app, { method: "PATCH", url: "/household/me", payload: { displayName: "   " } });
    expect(res.statusCode).toBe(400);
  });

  it("400s outside 1-24 characters after trimming", async () => {
    const db = mockDbMulti([await buildSession()], []);
    const app = build(db);
    const res = await authed(app, {
      method: "PATCH",
      url: "/household/me",
      payload: { displayName: "x".repeat(25) },
    });
    expect(res.statusCode).toBe(400);
  });

  it("saves a trimmed name and returns SelfDto", async () => {
    const updated = makeUser({ displayName: "Marta" });
    const db = mockDbMulti([await buildSession()], [], [updated]);
    const app = build(db);
    const res = await authed(app, { method: "PATCH", url: "/household/me", payload: { displayName: "  Marta  " } });
    expect(res.statusCode).toBe(200);
    expect(res.json().displayName).toBe("Marta");
  });
});

describe("GET /household/members", () => {
  it("404s when the caller has no household", async () => {
    const db = mockDbMulti([await buildSession()], [], [makeUser({ householdId: null })]);
    const app = build(db);
    const res = await authed(app, { method: "GET", url: "/household/members" });
    expect(res.statusCode).toBe(404);
  });

  it("returns every member with no email field", async () => {
    const self = makeUser();
    const other = makeUser({ id: OTHER_ID, displayName: "Ilya", email: "ilya@example.com" });
    const db = mockDbMulti([await buildSession()], [], [self], [self, other]);
    const app = build(db);
    const res = await authed(app, { method: "GET", url: "/household/members" });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("@");
    expect(res.json()).toHaveLength(2);
  });
});

describe("POST /household/codes", () => {
  it("400s before the caller has set a display name", async () => {
    const db = mockDbMulti([await buildSession()], [], [makeUser({ displayName: null })]);
    const app = build(db);
    const res = await authed(app, { method: "POST", url: "/household/codes" });
    expect(res.statusCode).toBe(400);
  });

  it("404s when the caller has no household", async () => {
    const db = mockDbMulti([await buildSession()], [], [makeUser({ householdId: null })]);
    const app = build(db);
    const res = await authed(app, { method: "POST", url: "/household/codes" });
    expect(res.statusCode).toBe(404);
  });

  it("revokes every previous live code before inserting the new one", async () => {
    const newCode = makeJoinCode({ code: "NEWCODE" });
    const db = mockDbMulti([await buildSession()], [], [makeUser()], [], [newCode]);
    const updateSpy = vi.spyOn(db, "update");
    const insertSpy = vi.spyOn(db, "insert");
    const app = build(db);
    const res = await authed(app, { method: "POST", url: "/household/codes" });
    expect(res.statusCode).toBe(200);
    // call 0 is the auth slide-expiry update on sessions; call 1 is the revoke.
    expect(updateSpy).toHaveBeenCalledTimes(2);
    expect(updateSpy.mock.calls[1][0]).toBe(joinCodes);
    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(insertSpy.mock.calls[0][0]).toBe(joinCodes);
    expect(res.json().code).toBe("NEWCODE");
  });
});

describe("GET /household/codes/live", () => {
  it("returns null when no code is live", async () => {
    const db = mockDbMulti([await buildSession()], [], [makeUser()], []);
    const app = build(db);
    const res = await authed(app, { method: "GET", url: "/household/codes/live" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
  });

  it("returns the live code when one exists", async () => {
    const code = makeJoinCode();
    const db = mockDbMulti([await buildSession()], [], [makeUser()], [code]);
    const app = build(db);
    const res = await authed(app, { method: "GET", url: "/household/codes/live" });
    expect(res.statusCode).toBe(200);
    expect(res.json().code).toBe(code.code);
  });
});

describe("GET /household/join/:code", () => {
  it("previews the household and pets for a redeemable code", async () => {
    const code = makeJoinCode();
    const household = makeHousehold({ name: "Home" });
    const db = mockDbMulti([await buildSession()], [], [code], [household], [makeUser()]);
    const app = build(db);
    const res = await authed(app, { method: "GET", url: `/household/join/${code.code}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.householdId).toBe(household.id);
    expect(body.householdName).toBe("Home");
    expect(body.memberCount).toBe(1);
    expect(body.pets).toEqual([]);
  });

  it("refuses an unknown code with not_found", async () => {
    const db = mockDbMulti([await buildSession()], [], []);
    const app = build(db);
    const res = await authed(app, { method: "GET", url: "/household/join/ZZZZZZ" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: "join_code_rejected", reason: "not_found" });
  });

  it("refuses an already-used code", async () => {
    const code = makeJoinCode({ usedBy: OTHER_ID });
    const db = mockDbMulti([await buildSession()], [], [code]);
    const app = build(db);
    const res = await authed(app, { method: "GET", url: `/household/join/${code.code}` });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "join_code_rejected", reason: "already_used" });
  });
});

describe("POST /household/join", () => {
  it("refuses when the caller already belongs to a household", async () => {
    const db = mockDbMulti([await buildSession()], [], [makeUser()]);
    const app = build(db);
    const res = await authed(app, {
      method: "POST",
      url: "/household/join",
      payload: { code: "ABCDEF" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "join_code_rejected", reason: "already_in_household" });
  });

  it("refuses a code that has already been redeemed (through the route)", async () => {
    const usedRow = makeJoinCode({ usedBy: OTHER_ID });
    const db = mockDbMulti([await buildSession()], [], [makeUser({ householdId: null })], [], [usedRow]);
    const app = build(db);
    const res = await authed(app, {
      method: "POST",
      url: "/household/join",
      payload: { code: usedRow.code },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "join_code_rejected", reason: "already_used" });
  });

  it("refuses an expired code (through the route)", async () => {
    const expiredRow = makeJoinCode({ expiresAt: new Date(Date.now() - 1000) });
    const db = mockDbMulti([await buildSession()], [], [makeUser({ householdId: null })], [], [expiredRow]);
    const app = build(db);
    const res = await authed(app, {
      method: "POST",
      url: "/household/join",
      payload: { code: expiredRow.code },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "join_code_rejected", reason: "expired" });
  });

  it("refuses a code revoked by a newer one (through the route)", async () => {
    const revokedRow = makeJoinCode({ revokedAt: new Date() });
    const db = mockDbMulti([await buildSession()], [], [makeUser({ householdId: null })], [], [revokedRow]);
    const app = build(db);
    const res = await authed(app, {
      method: "POST",
      url: "/household/join",
      payload: { code: revokedRow.code },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "join_code_rejected", reason: "revoked" });
  });

  it("refuses an unknown code with not_found (through the route)", async () => {
    const db = mockDbMulti([await buildSession()], [], [makeUser({ householdId: null })], [], []);
    const app = build(db);
    const res = await authed(app, {
      method: "POST",
      url: "/household/join",
      payload: { code: "ZZZZZZ" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: "join_code_rejected", reason: "not_found" });
  });

  it("consumes the code atomically and moves the caller into the household", async () => {
    const caller = makeUser({ householdId: null, tint: 1 });
    const claimed = makeJoinCode({ usedBy: caller.id });
    const existingMember = makeUser({ id: OTHER_ID, tint: 1 });
    const updatedCaller = makeUser({ id: caller.id, householdId: HOUSEHOLD_ID, tint: 2 });
    const household = makeHousehold();

    const db = mockDbMulti(
      [await buildSession()],
      [],
      [caller], // select caller
      [claimed], // atomic update on join_codes
      [existingMember], // members already in the household, for tint assignment
      [updatedCaller], // update users returning
      [household], // select household
      [existingMember, updatedCaller], // updated members list
    );
    const fromSpy = vi.spyOn(db, "from");
    const updateSpy = vi.spyOn(db, "update");
    const app = build(db);
    const res = await authed(app, {
      method: "POST",
      url: "/household/join",
      payload: { code: claimed.code },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.self.householdId).toBe(HOUSEHOLD_ID);
    expect(body.self.tint).toBe(2);
    expect(body.members).toHaveLength(2);

    // The atomic conditional update is the only thing consulted to consume the code —
    // join_codes is never SELECTed on the success path, only UPDATEd.
    expect(updateSpy.mock.calls[1][0]).toBe(joinCodes);
    expect(updateSpy.mock.calls[2][0]).toBe(users);
    expect(fromSpy.mock.calls.map((call) => call[0])).not.toContain(joinCodes);
  });
});

describe("DELETE /household/members/:userId", () => {
  it("404s when the target is not a member of the caller's household", async () => {
    const caller = makeUser();
    const target = makeUser({ id: OTHER_ID, householdId: "some-other-household" });
    const db = mockDbMulti([await buildSession()], [], [caller], [target]);
    const app = build(db);
    const res = await authed(app, { method: "DELETE", url: `/household/members/${OTHER_ID}` });
    expect(res.statusCode).toBe(404);
  });

  it("clears the target's membership and writes no history", async () => {
    const caller = makeUser();
    const target = makeUser({ id: OTHER_ID, displayName: "Ilya" });
    const db = mockDbMulti([await buildSession()], [], [caller], [target], []);
    const insertSpy = vi.spyOn(db, "insert");
    const updateSpy = vi.spyOn(db, "update");
    const app = build(db);
    const res = await authed(app, { method: "DELETE", url: `/household/members/${OTHER_ID}` });
    expect(res.statusCode).toBe(200);
    expect(insertSpy).not.toHaveBeenCalled();
    // call 0 is the auth slide-expiry update; call 1 clears household_id only.
    expect(updateSpy).toHaveBeenCalledTimes(2);
    expect(updateSpy.mock.calls[1][0]).toBe(users);
  });
});

describe("POST /household/leave", () => {
  it("409s the last member's leave without confirmation, and the household still exists", async () => {
    const caller = makeUser();
    const db = mockDbMulti([await buildSession()], [], [caller], [caller]);
    const deleteSpy = vi.spyOn(db, "delete");
    const app = build(db);
    const res = await authed(app, { method: "POST", url: "/household/leave", payload: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("confirmation_required");
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("deletes the household when the last member confirms", async () => {
    const caller = makeUser();
    const db = mockDbMulti([await buildSession()], [], [caller], [caller], [], [], []);
    const deleteSpy = vi.spyOn(db, "delete");
    const app = build(db);
    const res = await authed(app, {
      method: "POST",
      url: "/household/leave",
      payload: { confirmDelete: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ householdDeleted: true });
    expect(deleteSpy).toHaveBeenCalledTimes(2);
    expect(deleteSpy.mock.calls[0][0]).toBe(joinCodes);
    expect(deleteSpy.mock.calls[1][0]).toBe(households);
  });

  it("does not delete the household when other members remain", async () => {
    const caller = makeUser();
    const other = makeUser({ id: OTHER_ID });
    const db = mockDbMulti([await buildSession()], [], [caller], [caller, other], []);
    const deleteSpy = vi.spyOn(db, "delete");
    const app = build(db);
    const res = await authed(app, { method: "POST", url: "/household/leave", payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ householdDeleted: false });
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});

describe("email exposure", () => {
  it("no response body contains an email except self on household-state routes", async () => {
    const self = makeUser({ email: "self@example.com" });
    const other = makeUser({ id: OTHER_ID, displayName: "Ilya", email: "ilya@example.com" });
    const household = makeHousehold();

    const db = mockDbMulti([await buildSession()], [], [self], [household], [self, other]);
    const app = build(db);
    const res = await authed(app, { method: "GET", url: "/household" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.self.email).toBe(self.email);
    expect(res.body).not.toContain(other.email);
    // self's own email appears exactly once, in the self field.
    expect(res.body.split(self.email).length - 1).toBe(1);
    expect(JSON.stringify(body.members)).not.toContain("@");
  });

  it("GET /household/members never carries an email", async () => {
    const self = makeUser({ email: "self@example.com" });
    const other = makeUser({ id: OTHER_ID, displayName: "Ilya", email: "ilya@example.com" });
    const db = mockDbMulti([await buildSession()], [], [self], [self, other]);
    const app = build(db);
    const res = await authed(app, { method: "GET", url: "/household/members" });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("@");
  });
});
