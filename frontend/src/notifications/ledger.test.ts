import { describe, expect, it, vi } from "vitest";
import { AlertLedger, MAX_ALERTS_PER_DOSE, SNOOZE_MINUTES, type LedgerStorage } from "./ledger";

const DAY_MS = 24 * 60 * 60 * 1000;

/** An in-memory LedgerStorage that behaves like a real backing store: two
 *  AlertLedgers built over the SAME instance see each other's writes, which
 *  is exactly what the reload test needs to exercise. */
function memoryStorage(initial: string | null = null): LedgerStorage {
  let value = initial;
  return {
    read: () => value,
    write: (v: string) => {
      value = v;
    },
  };
}

describe("AlertLedger.claim", () => {
  it("succeeds on the first claim for a dose", () => {
    const ledger = new AlertLedger(memoryStorage());
    expect(ledger.claim("dose-1", "due", 1000)).toBe(true);
    expect(ledger.countFor("dose-1")).toBe(1);
    expect(ledger.recordFor("dose-1")?.reasons).toEqual(["due"]);
  });

  it("succeeds on a second claim with a different reason", () => {
    const ledger = new AlertLedger(memoryStorage());
    expect(ledger.claim("dose-1", "due", 1000)).toBe(true);
    expect(ledger.claim("dose-1", "overdue", 2000)).toBe(true);
    expect(ledger.countFor("dose-1")).toBe(2);
  });

  it("refuses a third claim of any reason once the budget is spent", () => {
    const ledger = new AlertLedger(memoryStorage());
    expect(ledger.claim("dose-1", "due", 1000)).toBe(true);
    expect(ledger.claim("dose-1", "overdue", 2000)).toBe(true);
    const before = ledger.recordFor("dose-1");

    expect(ledger.claim("dose-1", "snooze", 3000)).toBe(false);

    expect(ledger.countFor("dose-1")).toBe(MAX_ALERTS_PER_DOSE);
    expect(ledger.recordFor("dose-1")).toEqual(before);
  });

  it("refuses the same reason twice", () => {
    const ledger = new AlertLedger(memoryStorage());
    expect(ledger.claim("dose-1", "due", 1000)).toBe(true);
    const before = ledger.recordFor("dose-1");

    expect(ledger.claim("dose-1", "due", 1500)).toBe(false);

    expect(ledger.recordFor("dose-1")).toEqual(before);
  });

  it("refuses a claim while the dose is snoozed", () => {
    const ledger = new AlertLedger(memoryStorage());
    expect(ledger.claim("dose-1", "due", 1000)).toBe(true);
    expect(ledger.snooze("dose-1", 2000)).toBe(true);
    const snoozeUntil = ledger.recordFor("dose-1")!.snoozeUntil!;

    // Prove the refusal is caused by the snooze, not by the budget: this
    // reason has not fired before and the budget still has room.
    const before = ledger.recordFor("dose-1");
    expect(ledger.claim("dose-1", "overdue", snoozeUntil - 1)).toBe(false);
    expect(ledger.recordFor("dose-1")).toEqual(before);

    // And once the snooze has actually elapsed, the same claim succeeds —
    // confirming the earlier refusal really was about the snooze window.
    expect(ledger.claim("dose-1", "overdue", snoozeUntil)).toBe(true);
  });
});

describe("AlertLedger.snooze", () => {
  it("records a snooze SNOOZE_MINUTES ahead of now when budget remains", () => {
    const ledger = new AlertLedger(memoryStorage());
    expect(ledger.claim("dose-1", "due", 1000)).toBe(true);
    expect(ledger.snooze("dose-1", 5000)).toBe(true);
    expect(ledger.recordFor("dose-1")?.snoozeUntil).toBe(5000 + SNOOZE_MINUTES * 60_000);
  });

  it("returns false and changes nothing once the budget is already spent", () => {
    const ledger = new AlertLedger(memoryStorage());
    expect(ledger.claim("dose-1", "due", 1000)).toBe(true);
    expect(ledger.claim("dose-1", "overdue", 2000)).toBe(true);
    const before = ledger.recordFor("dose-1");

    expect(ledger.snooze("dose-1", 3000)).toBe(false);

    expect(ledger.recordFor("dose-1")).toEqual(before);
  });
});

describe("AlertLedger — reload survives", () => {
  it("a NEW AlertLedger built over the SAME storage still refuses once the budget is spent", () => {
    const storage = memoryStorage();
    const first = new AlertLedger(storage);
    expect(first.claim("dose-1", "due", 1000)).toBe(true);
    expect(first.claim("dose-1", "overdue", 2000)).toBe(true);

    // A fresh instance, as a page reload would construct, reading the same
    // underlying storage.
    const reloaded = new AlertLedger(storage);
    expect(reloaded.countFor("dose-1")).toBe(2);
    expect(reloaded.claim("dose-1", "snooze", 3000)).toBe(false);
  });
});

describe("AlertLedger — corrupt storage", () => {
  it("treats unparseable JSON as an empty ledger, silently", () => {
    const storage: LedgerStorage = {
      read: () => "{not valid json",
      write: vi.fn(),
    };
    expect(() => new AlertLedger(storage)).not.toThrow();
    const ledger = new AlertLedger(storage);
    expect(ledger.countFor("dose-1")).toBe(0);
    // Prove "empty" really means empty, not "always refuses": a fresh claim
    // on top of the corrupt read still succeeds.
    expect(ledger.claim("dose-1", "due", 1000)).toBe(true);
  });

  it("does not break claim when storage.write throws", () => {
    const storage: LedgerStorage = {
      read: () => null,
      write: () => {
        throw new Error("Safari private mode");
      },
    };
    const ledger = new AlertLedger(storage);
    expect(() => ledger.claim("dose-1", "due", 1000)).not.toThrow();
    expect(ledger.claim("dose-1", "overdue", 2000)).toBe(true);
    expect(ledger.countFor("dose-1")).toBe(2);
  });
});

describe("AlertLedger.prune", () => {
  it("drops records untouched for more than 7 days and keeps newer ones", () => {
    const now = 10 * DAY_MS;
    const oldRecord = {
      key: "old-dose",
      reasons: ["due"],
      snoozeUntil: null,
      updatedAt: now - 8 * DAY_MS,
    };
    const freshRecord = {
      key: "fresh-dose",
      reasons: ["due"],
      snoozeUntil: null,
      updatedAt: now - 1 * DAY_MS,
    };
    const storage = memoryStorage(
      JSON.stringify({ "old-dose": oldRecord, "fresh-dose": freshRecord }),
    );
    const ledger = new AlertLedger(storage);

    // Prove both are present before pruning.
    expect(ledger.recordFor("old-dose")).not.toBeNull();
    expect(ledger.recordFor("fresh-dose")).not.toBeNull();

    ledger.prune(now);

    expect(ledger.recordFor("old-dose")).toBeNull();
    expect(ledger.recordFor("fresh-dose")).not.toBeNull();

    // Pruning persists — a reload does not resurrect the dropped record.
    const reloaded = new AlertLedger(storage);
    expect(reloaded.recordFor("old-dose")).toBeNull();
    expect(reloaded.recordFor("fresh-dose")).not.toBeNull();
  });
});
