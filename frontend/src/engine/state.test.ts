import { describe, expect, it } from "vitest";
import { GRACE_FIXED_MIN, GRACE_INTERVAL_CAP_MIN, occurrenceKeyFor } from "@/domain";
import type { DoseEvent } from "@/domain";
import type { Occurrence } from "./engine.types";
import { getDoseState, summariseDay } from "./state";

// The test runner pins TZ=Europe/London (see vitest.config.ts).

function makeOccurrence(
  overrides: Partial<Occurrence> & { courseId: string; dueAt: Date | null },
): Occurrence {
  const scheduledFor = overrides.dueAt ? overrides.dueAt.toISOString() : null;
  return {
    key: occurrenceKeyFor(overrides.courseId, scheduledFor),
    petId: "pet-1",
    medicationId: "med-1",
    kind: "fixedTimes",
    day: "2026-08-10",
    graceMinutes: GRACE_FIXED_MIN,
    doseAmount: 1,
    doseUnit: "ml",
    instructions: null,
    event: null,
    ...overrides,
  };
}

let eventSeq = 0;
function makeEvent(
  overrides: Partial<DoseEvent> & { courseId: string; occurrenceKey: string },
): DoseEvent {
  eventSeq += 1;
  return {
    id: `event-${eventSeq}`,
    scheduledFor: null,
    status: "given",
    loggedAt: "2026-08-01T00:00:00.000Z",
    givenAt: "2026-08-01T00:00:00.000Z",
    amount: 1,
    note: null,
    supersedesId: null,
    actorId: "test-actor-id",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

describe("getDoseState", () => {
  const courseId = "course-state";

  it("returns 'given' when the live event status is 'given'", () => {
    const dueAt = new Date(2026, 7, 10, 8, 0);
    const occ = makeOccurrence({
      courseId,
      dueAt,
      event: makeEvent({ courseId, occurrenceKey: occurrenceKeyFor(courseId, dueAt.toISOString()), status: "given" }),
    });
    expect(getDoseState(occ, new Date(2026, 7, 10, 8, 0))).toBe("given");
  });

  it("returns 'skipped' when the live event status is 'skipped'", () => {
    const dueAt = new Date(2026, 7, 10, 8, 0);
    const occ = makeOccurrence({
      courseId,
      dueAt,
      event: makeEvent({ courseId, occurrenceKey: occurrenceKeyFor(courseId, dueAt.toISOString()), status: "skipped" }),
    });
    expect(getDoseState(occ, new Date(2026, 7, 10, 8, 0))).toBe("skipped");
  });

  it("returns 'notStarted' when dueAt is null (fromLastDose, no anchorTime, never started)", () => {
    const occ = makeOccurrence({ courseId, dueAt: null });
    expect(getDoseState(occ, new Date(2026, 7, 10, 12, 0))).toBe("notStarted");
  });

  it("returns 'notStarted' for a fromLastDose chain that never started even though anchorTime seeded a display dueAt", () => {
    const seededDueAt = new Date(2026, 7, 10, 9, 0);
    const occ = makeOccurrence({
      courseId,
      dueAt: seededDueAt,
      key: occurrenceKeyFor(courseId, null), // the "|-" sentinel: chain has not started
      kind: "fromLastDose",
      graceMinutes: GRACE_INTERVAL_CAP_MIN,
    });
    // Even well past the seeded time, this stays notStarted, never overdue.
    expect(getDoseState(occ, new Date(2026, 7, 10, 23, 0))).toBe("notStarted");
  });

  it("exactly at the fixedTimes grace boundary (60 min) is not yet overdue", () => {
    const dueAt = new Date(2026, 7, 10, 8, 0);
    const occ = makeOccurrence({ courseId, dueAt, graceMinutes: GRACE_FIXED_MIN });
    const now = new Date(dueAt.getTime() + GRACE_FIXED_MIN * 60_000);
    expect(getDoseState(occ, now)).toBe("due");
  });

  it("one millisecond past the fixedTimes grace boundary (60 min) is overdue", () => {
    const dueAt = new Date(2026, 7, 10, 8, 0);
    const occ = makeOccurrence({ courseId, dueAt, graceMinutes: GRACE_FIXED_MIN });
    const now = new Date(dueAt.getTime() + GRACE_FIXED_MIN * 60_000 + 1);
    expect(getDoseState(occ, now)).toBe("overdue");
  });

  it("exactly at the fromLastDose grace boundary (90 min) is not yet overdue", () => {
    const dueAt = new Date(2026, 7, 10, 8, 0);
    const occ = makeOccurrence({ courseId, dueAt, kind: "fromLastDose", graceMinutes: GRACE_INTERVAL_CAP_MIN });
    const now = new Date(dueAt.getTime() + GRACE_INTERVAL_CAP_MIN * 60_000);
    expect(getDoseState(occ, now)).toBe("due");
  });

  it("one millisecond past the fromLastDose grace boundary (90 min) is overdue", () => {
    const dueAt = new Date(2026, 7, 10, 8, 0);
    const occ = makeOccurrence({ courseId, dueAt, kind: "fromLastDose", graceMinutes: GRACE_INTERVAL_CAP_MIN });
    const now = new Date(dueAt.getTime() + GRACE_INTERVAL_CAP_MIN * 60_000 + 1);
    expect(getDoseState(occ, now)).toBe("overdue");
  });

  it("29 minutes before due is 'due', not 'later' — the pre-window beats later", () => {
    const dueAt = new Date(2026, 7, 10, 8, 0);
    const occ = makeOccurrence({ courseId, dueAt });
    const now = new Date(dueAt.getTime() - 29 * 60_000);
    expect(getDoseState(occ, now)).toBe("due");
  });

  it("well before the pre-window, due later today, is 'later'", () => {
    const dueAt = new Date(2026, 7, 10, 8, 0);
    const occ = makeOccurrence({ courseId, dueAt });
    const now = new Date(2026, 7, 10, 0, 0); // same local day, far outside the 30-minute pre-window
    expect(getDoseState(occ, now)).toBe("later");
  });

  it("returns 'upcoming' when dueAt falls on a future day", () => {
    const dueAt = new Date(2026, 7, 12, 8, 0);
    const occ = makeOccurrence({ courseId, dueAt });
    expect(getDoseState(occ, new Date(2026, 7, 10, 8, 0))).toBe("upcoming");
  });

  // SPEC §3b-i / §12: "an interval course with no maximum set behaves
  // exactly as before" and "a capped course never appears in the overdue
  // count or the overdue banner".
  describe("capped (SPEC §3b-i)", () => {
    it("returns 'capped' when givenToday reaches maxPerDay, even though dueAt is far enough past to otherwise be overdue", () => {
      const dueAt = new Date(2026, 7, 10, 8, 0);
      const occ = makeOccurrence({
        courseId,
        dueAt,
        kind: "fromLastDose",
        graceMinutes: GRACE_INTERVAL_CAP_MIN,
        maxPerDay: 3,
        givenToday: 3,
      });
      // Well past due + grace — would be 'overdue' were it not capped.
      const now = new Date(dueAt.getTime() + GRACE_INTERVAL_CAP_MIN * 60_000 + 60_000);
      expect(getDoseState(occ, now)).toBe("capped");
    });

    it("returns 'capped' when givenToday exceeds maxPerDay (a 'Give anyway' dose already pushed the count past it)", () => {
      const dueAt = new Date(2026, 7, 10, 8, 0);
      const occ = makeOccurrence({
        courseId,
        dueAt,
        kind: "fromLastDose",
        graceMinutes: GRACE_INTERVAL_CAP_MIN,
        maxPerDay: 3,
        givenToday: 4,
      });
      expect(getDoseState(occ, dueAt)).toBe("capped");
    });

    it("does NOT return 'capped' while givenToday is still under maxPerDay — ordinary due/overdue rules apply unchanged", () => {
      const dueAt = new Date(2026, 7, 10, 8, 0);
      const occ = makeOccurrence({
        courseId,
        dueAt,
        kind: "fromLastDose",
        graceMinutes: GRACE_INTERVAL_CAP_MIN,
        maxPerDay: 3,
        givenToday: 2,
      });
      const now = new Date(dueAt.getTime() + GRACE_INTERVAL_CAP_MIN * 60_000 + 60_000);
      expect(getDoseState(occ, now)).toBe("overdue");
    });

    it("'given'/'skipped' still take precedence over 'capped' when both would apply", () => {
      const dueAt = new Date(2026, 7, 10, 8, 0);
      const key = occurrenceKeyFor(courseId, dueAt.toISOString());
      const occ = makeOccurrence({
        courseId,
        dueAt,
        kind: "fromLastDose",
        graceMinutes: GRACE_INTERVAL_CAP_MIN,
        maxPerDay: 3,
        givenToday: 3,
        event: makeEvent({ courseId, occurrenceKey: key, status: "given" }),
      });
      expect(getDoseState(occ, dueAt)).toBe("given");
    });

    // SPEC §3b-i's builder checklist / §12: the unset case is a true no-op —
    // `maxPerDay`/`givenToday` simply absent (never computed for a course
    // without a cap), so `capped` can never be reached regardless of how far
    // overdue the occurrence is. This is the CRITICAL SCOPE GUARD for this
    // feature: it proves the no-op, not merely the cap.
    it("CRITICAL SCOPE GUARD: with maxPerDay/givenToday both absent, 'capped' is never reached — even a wildly overdue occurrence still reads 'overdue'", () => {
      const dueAt = new Date(2026, 7, 10, 8, 0);
      const occ = makeOccurrence({
        courseId,
        dueAt,
        kind: "fromLastDose",
        graceMinutes: GRACE_INTERVAL_CAP_MIN,
        // maxPerDay/givenToday intentionally omitted — exactly what
        // `occurrences.ts` produces for a course with no `maxPerDay` set.
      });
      const now = new Date(dueAt.getTime() + 30 * 24 * 60 * 60_000); // 30 days later
      expect(getDoseState(occ, now)).toBe("overdue");
    });
  });

  it("a 'missed' DoseEvent leaves the occurrence 'overdue', not a distinct state", () => {
    const dueAt = new Date(2026, 7, 10, 8, 0);
    const key = occurrenceKeyFor(courseId, dueAt.toISOString());
    const occ = makeOccurrence({
      courseId,
      dueAt,
      event: makeEvent({ courseId, occurrenceKey: key, status: "missed" }),
    });
    const now = new Date(dueAt.getTime() + GRACE_FIXED_MIN * 60_000 + 1);
    expect(getDoseState(occ, now)).toBe("overdue");
  });
});

describe("summariseDay", () => {
  it("counts remaining as overdue+due+later, overdue separately, and picks the earliest overdue occurrence", () => {
    const now = new Date(2026, 7, 10, 10, 0);
    const overdue1 = makeOccurrence({ courseId: "c1", dueAt: new Date(2026, 7, 10, 7, 0) });
    const overdue2 = makeOccurrence({ courseId: "c2", dueAt: new Date(2026, 7, 10, 8, 30) });
    const dueOcc = makeOccurrence({ courseId: "c3", dueAt: new Date(2026, 7, 10, 10, 20) });
    const laterOcc = makeOccurrence({ courseId: "c4", dueAt: new Date(2026, 7, 10, 18, 0) });
    const givenDueAt = new Date(2026, 7, 10, 9, 0);
    const givenOcc = makeOccurrence({
      courseId: "c5",
      dueAt: givenDueAt,
      event: makeEvent({
        courseId: "c5",
        occurrenceKey: occurrenceKeyFor("c5", givenDueAt.toISOString()),
        status: "given",
      }),
    });
    const upcomingOcc = makeOccurrence({ courseId: "c6", dueAt: new Date(2026, 7, 12, 8, 0) });
    const notStartedOcc = makeOccurrence({ courseId: "c7", dueAt: null });

    const summary = summariseDay(
      [overdue1, overdue2, dueOcc, laterOcc, givenOcc, upcomingOcc, notStartedOcc],
      now,
    );

    expect(summary.overdue).toBe(2);
    expect(summary.remaining).toBe(4);
    expect(summary.earliestOverdue?.courseId).toBe("c1");
  });

  it("reports overdue: 0 and earliestOverdue: null when nothing is overdue (SPEC §5.1 drops the clause)", () => {
    const now = new Date(2026, 7, 10, 7, 0);
    const laterOcc = makeOccurrence({ courseId: "c1", dueAt: new Date(2026, 7, 10, 18, 0) });
    const summary = summariseDay([laterOcc], now);
    expect(summary.overdue).toBe(0);
    expect(summary.earliestOverdue).toBeNull();
  });

  // Part 2 consumer fix (SPEC §3b): an anchored `fromLastDose` chain's next
  // dose stays a live, giveable row before its due instant crosses into a
  // later local day (`occurrences.ts`'s `fromLastDoseOccurrences`), so it
  // must count toward "remaining" — otherwise the header reads "0 doses
  // left" above a card that still has a Give button on it.
  it("counts an 'upcoming' fromLastDose occurrence toward remaining, never an 'upcoming' fixedTimes one (CRITICAL SCOPE GUARD)", () => {
    const now = new Date(2026, 7, 10, 10, 0);
    const upcomingInterval = makeOccurrence({
      courseId: "c1",
      kind: "fromLastDose",
      graceMinutes: GRACE_INTERVAL_CAP_MIN,
      dueAt: new Date(2026, 7, 11, 3, 0), // tomorrow
    });
    const upcomingFixed = makeOccurrence({
      courseId: "c2",
      kind: "fixedTimes",
      dueAt: new Date(2026, 7, 12, 8, 0), // two days out — never reachable in
      // practice for a real fixedTimes occurrence (its dueAt is always
      // inside the day it was generated for), constructed directly here to
      // prove the guard itself rather than the invariant that normally
      // makes it moot.
    });

    const both = summariseDay([upcomingInterval, upcomingFixed], now);
    expect(both.remaining).toBe(1);

    const intervalOnly = summariseDay([upcomingInterval], now);
    expect(intervalOnly.remaining).toBe(1);

    const fixedOnly = summariseDay([upcomingFixed], now);
    expect(fixedOnly.remaining).toBe(0);
  });

  // SPEC §3b-i / §12: "a capped course never appears in the overdue count or
  // the overdue banner" — it must still count toward `remaining` (it is
  // still an outstanding, actionable row) but never toward `overdue`.
  it("counts a capped occurrence toward remaining, never toward overdue or earliestOverdue", () => {
    const now = new Date(2026, 7, 10, 10, 0);
    const cappedOcc = makeOccurrence({
      courseId: "c1",
      kind: "fromLastDose",
      graceMinutes: GRACE_INTERVAL_CAP_MIN,
      dueAt: new Date(2026, 7, 10, 6, 0), // long past due + grace
      maxPerDay: 3,
      givenToday: 3,
    });
    const overdueOcc = makeOccurrence({ courseId: "c2", dueAt: new Date(2026, 7, 10, 7, 0) });

    const summary = summariseDay([cappedOcc, overdueOcc], now);
    expect(summary.remaining).toBe(2);
    expect(summary.overdue).toBe(1);
    expect(summary.earliestOverdue?.courseId).toBe("c2");
  });
});
