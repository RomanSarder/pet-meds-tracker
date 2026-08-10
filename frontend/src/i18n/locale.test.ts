import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY, readStoredLocale, writeStoredLocale } from "./locale";

beforeEach(() => {
  localStorage.clear();
});

describe("readStoredLocale / writeStoredLocale", () => {
  it("returns null on a fresh device with no stored preference (default locale applies)", () => {
    expect(readStoredLocale()).toBeNull();
    expect(DEFAULT_LOCALE).toBe("uk");
  });

  it("round-trips a stored 'en'", () => {
    writeStoredLocale("en");
    expect(readStoredLocale()).toBe("en");
  });

  it("round-trips a stored 'uk'", () => {
    writeStoredLocale("uk");
    expect(readStoredLocale()).toBe("uk");
  });

  it.each(["fr", "UK", "En", ""])("rejects junk stored value %j back to null", (junk) => {
    localStorage.setItem(LOCALE_STORAGE_KEY, junk);
    expect(readStoredLocale()).toBeNull();
  });

  it("rejects malformed/JSON-looking stored content", () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "{not json");
    expect(readStoredLocale()).toBeNull();
  });

  it("readStoredLocale is tolerant of localStorage throwing (private mode)", () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error("private mode");
    };
    try {
      expect(readStoredLocale()).toBeNull();
    } finally {
      Storage.prototype.getItem = original;
    }
  });

  it("writeStoredLocale is tolerant of localStorage throwing (private mode)", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("private mode");
    };
    try {
      expect(() => writeStoredLocale("en")).not.toThrow();
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});
