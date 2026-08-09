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
    const consoleSpies = [
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "log").mockImplementation(() => {}),
    ];
    try {
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
      for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("AlertLedger — a failed persist refuses the claim (Fix 2)", () => {
  it("storage.write throwing causes claim() to return false and leave no record, silently", () => {
    const consoleSpies = [
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "log").mockImplementation(() => {}),
    ];
    try {
      let broken = true;
      let stored: string | null = null;
      const storage: LedgerStorage = {
        read: () => stored,
        write: (v: string) => {
          if (broken) throw new Error("Safari private mode");
          stored = v;
        },
      };
      const ledger = new AlertLedger(storage);

      // A write failure must refuse the claim outright — a ledger that
      // cannot durably count must not authorise an alert. It must not grant
      // the alert and merely lose track of it (a silent extra budget).
      expect(() => ledger.claim("dose-1", "due", 1000)).not.toThrow();
      expect(ledger.claim("dose-1", "due", 1000)).toBe(false);
      expect(ledger.recordFor("dose-1")).toBeNull();
      expect(ledger.countFor("dose-1")).toBe(0);

      // Once storage recovers, the very next claim behaves as a genuine
      // first claim — not a budget already partly (or wrongly) spent.
      broken = false;
      expect(ledger.claim("dose-1", "due", 2000)).toBe(true);
      expect(ledger.countFor("dose-1")).toBe(1);

      for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("applies the same reasoning to snooze(): a throwing write refuses the snooze", () => {
    const storage: LedgerStorage = {
      read: () => null,
      write: () => {
        throw new Error("Safari private mode");
      },
    };
    const ledger = new AlertLedger(storage);
    expect(() => ledger.snooze("dose-1", 1000)).not.toThrow();
    expect(ledger.snooze("dose-1", 1000)).toBe(false);
    expect(ledger.recordFor("dose-1")).toBeNull();
  });
});

describe("AlertLedger — two tabs over the same storage (Fix 1)", () => {
  // Two AlertLedger instances constructed over the SAME backing storage,
  // simulating two browser tabs with the app open at once. Neither tab
  // knows about the other except through what is actually in `storage`.

  it("A-due then B-due: the second tab's claim of the SAME reason is refused, not duplicated", () => {
    const storage = memoryStorage();
    const tabA = new AlertLedger(storage);
    const tabB = new AlertLedger(storage);

    const aResult = tabA.claim("dose-1", "due", 1000);
    const bResult = tabB.claim("dose-1", "due", 1000);
    const successCount = [aResult, bResult].filter(Boolean).length;

    // "due" may be claimed at most ONCE for this dose (ledger.claim's own
    // "refuses the same reason twice" rule) — a stale per-tab cache that
    // never saw tab A's write is exactly what would let tab B's claim of
    // the identical reason succeed too.
    expect(successCount).toBe(1);
    expect(successCount).toBeLessThanOrEqual(MAX_ALERTS_PER_DOSE);
  });

  it("A-due then B-overdue then A-overdue: never more than two claims total", () => {
    const storage = memoryStorage();
    const tabA = new AlertLedger(storage);
    const tabB = new AlertLedger(storage);

    const results = [
      tabA.claim("dose-1", "due", 1000),
      tabB.claim("dose-1", "overdue", 2000),
      tabA.claim("dose-1", "overdue", 3000),
    ];
    const successCount = results.filter(Boolean).length;

    expect(successCount).toBeLessThanOrEqual(MAX_ALERTS_PER_DOSE);
  });

  it("A-due, A-overdue, then B claims anything: B is refused because the budget is already spent", () => {
    const storage = memoryStorage();
    const tabA = new AlertLedger(storage);
    const tabB = new AlertLedger(storage);

    const results = [
      tabA.claim("dose-1", "due", 1000),
      tabA.claim("dose-1", "overdue", 2000),
      // Tab B never claimed before this — under the old per-instance cache
      // it would still believe the dose has no record at all.
      tabB.claim("dose-1", "snooze", 3000),
    ];
    const successCount = results.filter(Boolean).length;

    expect(successCount).toBeLessThanOrEqual(MAX_ALERTS_PER_DOSE);
    // Confirm from a THIRD fresh instance (a third tab, or a reload) that
    // storage genuinely reflects only two alerts, not that we got lucky
    // with the count above.
    const tabC = new AlertLedger(storage);
    expect(tabC.countFor("dose-1")).toBe(MAX_ALERTS_PER_DOSE);
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
