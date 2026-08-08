import { describe, it, expect, vi } from "vitest";
import { buildApp, mockDb, mockDbMulti } from "../test-utils";
import authPlugin from "./index";
import { generateSecureRandomString, hashSecret } from "./utils";
import { addToDate } from "../utils";
import { users, magicLinkTokens, sessions } from "../db/schema";

const USER = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "test@example.com",
  createdAt: new Date(),
};

const MAGIC_LINK = {
  token: "validtoken123456789012",
  userId: USER.id,
  expiresAt: new Date(Date.now() + 900_000),
};

const EXPIRED_MAGIC_LINK = {
  token: "expiredtoken1234567890",
  userId: USER.id,
  expiresAt: new Date(Date.now() - 900_000),
};

const SESSION_SECRET = "sessionsecretvalue1234567";
const SESSION_ID = "sessionid1234567890123456";

function build(db: any) {
  const app = buildApp(db);
  app.register(authPlugin);
  return app;
}

async function buildSession(overrides: Partial<{ id: string; userId: string; expiresAt: Date }> = {}) {
  const secretHash = Buffer.from(await hashSecret(SESSION_SECRET)).toString("hex");
  return {
    id: SESSION_ID,
    userId: USER.id,
    secretHash,
    expiresAt: addToDate(new Date(), { days: 7 }),
    createdAt: new Date(),
    ...overrides,
  };
}

describe("POST /auth/sign-in", () => {
  it("creates a user and a magic-link token for a brand-new email", async () => {
    // DB calls: insert users (no conflict) -> [USER], insert magic_link_tokens -> [MAGIC_LINK]
    const db = mockDbMulti([USER], [MAGIC_LINK]);
    const selectSpy = vi.spyOn(db, "select");
    const insertSpy = vi.spyOn(db, "insert");

    const app = build(db);
    const res = await app.inject({
      method: "POST",
      url: "/auth/sign-in",
      payload: { email: USER.email },
    });

    expect(res.statusCode).toBe(200);
    expect(insertSpy).toHaveBeenCalledTimes(2);
    expect(insertSpy.mock.calls[0][0]).toBe(users);
    expect(insertSpy.mock.calls[1][0]).toBe(magicLinkTokens);
    // Existing-user lookup path (select) is never taken when the insert succeeds.
    expect(selectSpy).not.toHaveBeenCalled();
  });

  it("reuses the user for an existing email (no duplicate insert)", async () => {
    // DB calls: insert users (conflict) -> [], select users by email -> [USER], insert magic_link_tokens -> [MAGIC_LINK]
    const db = mockDbMulti([], [USER], [MAGIC_LINK]);
    const selectSpy = vi.spyOn(db, "select");
    const insertSpy = vi.spyOn(db, "insert");

    const app = build(db);
    const res = await app.inject({
      method: "POST",
      url: "/auth/sign-in",
      payload: { email: USER.email },
    });

    expect(res.statusCode).toBe(200);
    // Only ever one insert attempt against `users` (the onConflictDoNothing), plus the magic-link insert.
    expect(insertSpy).toHaveBeenCalledTimes(2);
    expect(insertSpy.mock.calls[0][0]).toBe(users);
    expect(selectSpy).toHaveBeenCalledTimes(1);
  });

  it("returns 200 without leaking whether the address existed", async () => {
    const newEmailApp = build(mockDbMulti([USER], [MAGIC_LINK]));
    const existingEmailApp = build(mockDbMulti([], [USER], [MAGIC_LINK]));

    const newRes = await newEmailApp.inject({
      method: "POST",
      url: "/auth/sign-in",
      payload: { email: "new@example.com" },
    });
    const existingRes = await existingEmailApp.inject({
      method: "POST",
      url: "/auth/sign-in",
      payload: { email: USER.email },
    });

    expect(newRes.statusCode).toBe(200);
    expect(existingRes.statusCode).toBe(200);
    expect(newRes.body).toBe(existingRes.body);
  });

  it("returns 400 for an invalid email format", async () => {
    const app = build(mockDb([]));
    const res = await app.inject({
      method: "POST",
      url: "/auth/sign-in",
      payload: { email: "not-an-email" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /auth/token/verify", () => {
  it("returns 401 for an unknown token, and creates no session", async () => {
    // DB calls: delete magic_link_tokens (returning) -> []
    const db = mockDbMulti([]);
    const insertSpy = vi.spyOn(db, "insert");

    const app = build(db);
    const res = await app.inject({
      method: "POST",
      url: "/auth/token/verify",
      query: { token: "nonexistenttoken12345" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().message).toBe("Invalid credentials");
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("returns 401 for an expired token, consumes it, and creates no session", async () => {
    // DB calls: delete magic_link_tokens (returning) -> [EXPIRED_MAGIC_LINK]
    const db = mockDbMulti([EXPIRED_MAGIC_LINK]);
    const deleteSpy = vi.spyOn(db, "delete");
    const insertSpy = vi.spyOn(db, "insert");

    const app = build(db);
    const res = await app.inject({
      method: "POST",
      url: "/auth/token/verify",
      query: { token: EXPIRED_MAGIC_LINK.token },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().message).toBe("Invalid credentials");
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy.mock.calls[0][0]).toBe(magicLinkTokens);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("returns 401 on the second verify of an already-consumed token", async () => {
    // The delete-and-return finds no row the second time a token is submitted.
    const db = mockDbMulti([]);
    const app = build(db);
    const res = await app.inject({
      method: "POST",
      url: "/auth/token/verify",
      query: { token: MAGIC_LINK.token },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().message).toBe("Invalid credentials");
  });

  it("returns 200, sets the cookie, and creates exactly one session for a valid token", async () => {
    // DB calls: delete magic_link_tokens (returning) -> [MAGIC_LINK], insert sessions -> []
    const db = mockDbMulti([MAGIC_LINK], []);
    const deleteSpy = vi.spyOn(db, "delete");
    const insertSpy = vi.spyOn(db, "insert");

    const app = build(db);
    const res = await app.inject({
      method: "POST",
      url: "/auth/token/verify",
      query: { token: MAGIC_LINK.token },
    });

    expect(res.statusCode).toBe(200);
    const setCookie = res.headers["set-cookie"] as string;
    expect(setCookie).toMatch(/pet_tracker_token=/);
    const cookieValue = setCookie.split("pet_tracker_token=")[1].split(";")[0];
    expect(cookieValue.split(".")).toHaveLength(2);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy.mock.calls[0][0]).toBe(magicLinkTokens);
    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(insertSpy.mock.calls[0][0]).toBe(sessions);
  });
});

describe("GET /auth/me", () => {
  it("returns 401 with no cookie", async () => {
    const app = build(mockDb([]));
    const res = await app.inject({ method: "GET", url: "/auth/me" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 when the cookie secret does not match the stored hash", async () => {
    const session = await buildSession();
    const app = build(mockDbMulti([session]));
    const res = await app.inject({
      method: "GET",
      url: "/auth/me",
      cookies: { pet_tracker_token: `${SESSION_ID}.wrong-secret-value-here` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 200 and { id, email } for a valid cookie", async () => {
    const session = await buildSession();
    // DB calls: select sessions -> [session], update sessions (slide expiry) -> [], select users -> [USER]
    const app = build(mockDbMulti([session], [], [USER]));
    const res = await app.inject({
      method: "GET",
      url: "/auth/me",
      cookies: { pet_tracker_token: `${SESSION_ID}.${SESSION_SECRET}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: USER.id, email: USER.email });
  });
});

describe("POST /auth/sign-out", () => {
  it("clears the session cookie", async () => {
    const session = await buildSession();
    // DB calls: select sessions -> [session], update sessions (slide expiry) -> [], delete sessions -> []
    const app = build(mockDbMulti([session], [], []));
    const res = await app.inject({
      method: "POST",
      url: "/auth/sign-out",
      cookies: { pet_tracker_token: `${SESSION_ID}.${SESSION_SECRET}` },
    });
    expect(res.statusCode).toBe(200);
    const setCookie = res.headers["set-cookie"] as string;
    expect(setCookie).toMatch(/pet_tracker_token=;/);
  });
});

describe("generateSecureRandomString", () => {
  it("produces a 24-character string", () => {
    expect(generateSecureRandomString()).toHaveLength(24);
  });

  it("only uses characters from the declared alphabet", () => {
    const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
    for (let i = 0; i < 20; i++) {
      const value = generateSecureRandomString();
      for (const char of value) {
        expect(alphabet).toContain(char);
      }
    }
  });
});

describe("addToDate", () => {
  it("adds days", () => {
    const base = new Date("2026-01-01T00:00:00.000Z");
    const result = addToDate(base, { days: 7 });
    expect(result.getUTCDate()).toBe(8);
  });

  it("adds minutes", () => {
    const base = new Date("2026-01-01T00:00:00.000Z");
    const result = addToDate(base, { minutes: 15 });
    expect(result.getTime() - base.getTime()).toBe(15 * 60 * 1000);
  });

  it("does not mutate the input date", () => {
    const base = new Date("2026-01-01T00:00:00.000Z");
    addToDate(base, { days: 1, minutes: 1 });
    expect(base.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});
