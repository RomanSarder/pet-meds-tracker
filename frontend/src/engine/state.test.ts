import { describe, expect, it } from "vitest";
import { GRACE_FIXED_MIN, GRACE_INTERVAL_MIN, occurrenceKeyFor } from "@/domain";
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
      graceMinutes: GRACE_INTERVAL_MIN,
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
    const occ = makeOccurrence({ courseId, dueAt, kind: "fromLastDose", graceMinutes: GRACE_INTERVAL_MIN });
    const now = new Date(dueAt.getTime() + GRACE_INTERVAL_MIN * 60_000);
    expect(getDoseState(occ, now)).toBe("due");
  });

  it("one millisecond past the fromLastDose grace boundary (90 min) is overdue", () => {
    const dueAt = new Date(2026, 7, 10, 8, 0);
    const occ = makeOccurrence({ courseId, dueAt, kind: "fromLastDose", graceMinutes: GRACE_INTERVAL_MIN });
    const now = new Date(dueAt.getTime() + GRACE_INTERVAL_MIN * 60_000 + 1);
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
});
