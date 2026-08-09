import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isSessionEstablished,
  markSessionEstablished,
  clearSessionEstablished,
  getStoreOwner,
  setStoreOwner,
} from "./session";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("sessionEstablished", () => {
  it("round-trips: unset, then marked, then cleared", () => {
    expect(isSessionEstablished()).toBe(false);
    markSessionEstablished();
    expect(isSessionEstablished()).toBe(true);
    clearSessionEstablished();
    expect(isSessionEstablished()).toBe(false);
  });
});

describe("storeOwner", () => {
  it("round-trips a set owner", () => {
    expect(getStoreOwner()).toBeNull();
    setStoreOwner("user-1");
    expect(getStoreOwner()).toBe("user-1");
  });
});

describe("independence of the two records", () => {
  it("established survives a clear of the owner", () => {
    markSessionEstablished();
    setStoreOwner("user-1");

    // No clearStoreOwner is exported; simulate the owner changing instead,
    // which must not disturb the established flag either way.
    setStoreOwner("user-2");
    expect(isSessionEstablished()).toBe(true);
  });

  it("owner survives a clear of established", () => {
    markSessionEstablished();
    setStoreOwner("user-1");

    clearSessionEstablished();

    expect(getStoreOwner()).toBe("user-1");
    expect(isSessionEstablished()).toBe(false);
  });
});

describe("a localStorage that throws (Safari private mode)", () => {
  it("does not throw out of any exported function", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError: storage disabled");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError: storage disabled");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("SecurityError: storage disabled");
    });

    expect(() => isSessionEstablished()).not.toThrow();
    expect(() => markSessionEstablished()).not.toThrow();
    expect(() => clearSessionEstablished()).not.toThrow();
    expect(() => getStoreOwner()).not.toThrow();
    expect(() => setStoreOwner("user-1")).not.toThrow();

    expect(isSessionEstablished()).toBe(false);
    expect(getStoreOwner()).toBeNull();
  });
});
