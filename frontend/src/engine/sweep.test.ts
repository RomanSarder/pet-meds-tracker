import { describe, expect, it } from "vitest";
import { occurrenceKeyFor } from "@/domain";
import type { Course, DoseEvent, Schedule } from "@/domain";
import type { EngineContext } from "./engine.types";
import { findCoursesToFinish, findMissedOccurrences, nextDueAt } from "./sweep";

// The test runner pins TZ=Europe/London (see vitest.config.ts).

let courseSeq = 0;
function makeCourse(overrides: Partial<Course> & { schedule: Schedule }): Course {
  courseSeq += 1;
  return {
    id: `course-${courseSeq}`,
    petId: "pet-1",
    medicationId: "med-1",
    doseAmount: 1,
    doseUnit: "ml",
    instructions: null,
    startDate: "2026-08-01",
    endDate: null,
    status: "active",
    notes: null,
    resumedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

let eventSeq = 0;
function makeEvent(overrides: Partial<DoseEvent> & { courseId: string }): DoseEvent {
  eventSeq += 1;
  const scheduledFor = overrides.scheduledFor ?? null;
  return {
    id: `event-${eventSeq}`,
    scheduledFor,
    status: "given",
    loggedAt: "2026-08-01T00:00:00.000Z",
    givenAt: "2026-08-01T00:00:00.000Z",
    amount: 1,
    note: null,
    occurrenceKey: occurrenceKeyFor(overrides.courseId, scheduledFor),
    supersedesId: null,
    actorId: "test-actor-id",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

describe("findMissedOccurrences", () => {
  it("returns a fixedTimes occurrence more than 12h past due with no live event", () => {
    // startDate === endDate: a single-day window so this course contributes
    // exactly one candidate occurrence in the lookback range, not one per day.
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["08:00"] },
      startDate: "2026-08-08",
      endDate: "2026-08-08",
    });
    const ctx: EngineContext = { courses: [course], events: [] };
    // 2026-08-08 08:00 local, now is 2026-08-10 10:00 local: well over 12h late.
    const now = new Date(2026, 7, 10, 10, 0);
    const missed = findMissedOccurrences(ctx, now);
    expect(missed).toHaveLength(1);
    expect(missed[0].dueAt?.toISOString()).toBe(new Date(2026, 7, 8, 8, 0).toISOString());
  });

  it("does not return a fixedTimes occurrence still within the 12h missed window", () => {
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["09:00"] },
      startDate: "2026-08-10",
      endDate: "2026-08-10",
    });
    const ctx: EngineContext = { courses: [course], events: [] };
    // Due today at 09:00, now is 10:00 the same day: only 1h late.
    const now = new Date(2026, 7, 10, 10, 0);
    expect(findMissedOccurrences(ctx, now)).toHaveLength(0);
  });

  it("never sweeps a fromLastDose (interval) course, even when many hours late", () => {
    const course = makeCourse({
      schedule: { kind: "fromLastDose", intervalHours: 8 },
      startDate: "2026-08-01",
    });
    const given = makeEvent({
      courseId: course.id,
      scheduledFor: null,
      status: "given",
      givenAt: "2026-08-05T22:00:00.000Z", // anchors a due instant on 2026-08-06, days before `now`
      loggedAt: "2026-08-05T22:00:00.000Z",
    });
    const ctx: EngineContext = { courses: [course], events: [given] };
    const now = new Date(2026, 7, 10, 10, 0);
    expect(findMissedOccurrences(ctx, now)).toHaveLength(0);
  });

  it("is idempotent: an occurrence that already has a 'missed' DoseEvent is not returned again", () => {
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["08:00"] },
      startDate: "2026-08-08",
      endDate: "2026-08-08",
    });
    const dueAt = new Date(2026, 7, 8, 8, 0);
    const missedEvent = makeEvent({
      courseId: course.id,
      scheduledFor: dueAt.toISOString(),
      status: "missed",
      loggedAt: "2026-08-08T20:00:00.000Z",
      givenAt: "2026-08-08T20:00:00.000Z",
    });
    const ctx: EngineContext = { courses: [course], events: [missedEvent] };
    const now = new Date(2026, 7, 10, 10, 0);
    expect(findMissedOccurrences(ctx, now)).toHaveLength(0);
  });

  it("defaults lookbackDays to 7: an occurrence 8 days ago is not found", () => {
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["08:00"] },
      startDate: "2026-08-02",
      endDate: "2026-08-02",
    });
    const ctx: EngineContext = { courses: [course], events: [] };
    // now's local day is 2026-08-10; 8 days back is 2026-08-02, outside the
    // default 7-day lookback window (2026-08-03..2026-08-10).
    const now = new Date(2026, 7, 10, 10, 0);
    expect(findMissedOccurrences(ctx, now)).toHaveLength(0);
    expect(findMissedOccurrences(ctx, now, { lookbackDays: 8 })).toHaveLength(1);
  });

  it("lookbackDays: 0 returns only candidates due today and terminates", () => {
    const today = makeCourse({
      schedule: { kind: "fixedTimes", times: ["08:00"] },
      startDate: "2026-08-10",
      endDate: "2026-08-10",
    });
    const yesterday = makeCourse({
      schedule: { kind: "fixedTimes", times: ["08:00"] },
      startDate: "2026-08-09",
      endDate: "2026-08-09",
    });
    const ctx: EngineContext = { courses: [today, yesterday], events: [] };
    // now's local day is 2026-08-10; today's 08:00 occurrence is >12h late.
    const now = new Date(2026, 7, 10, 21, 0);
    const missed = findMissedOccurrences(ctx, now, { lookbackDays: 0 });
    expect(missed).toHaveLength(1);
    expect(missed[0].dueAt?.toISOString()).toBe(new Date(2026, 7, 10, 8, 0).toISOString());
  });

  it(
    "a negative lookbackDays terminates and behaves like 0 rather than hanging",
    { timeout: 5000 },
    () => {
      const today = makeCourse({
        schedule: { kind: "fixedTimes", times: ["08:00"] },
        startDate: "2026-08-10",
        endDate: "2026-08-10",
      });
      const ctx: EngineContext = { courses: [today], events: [] };
      const now = new Date(2026, 7, 10, 21, 0);
      const missed = findMissedOccurrences(ctx, now, { lookbackDays: -3 });
      expect(missed).toHaveLength(1);
      expect(missed[0].dueAt?.toISOString()).toBe(new Date(2026, 7, 10, 8, 0).toISOString());
    },
  );
});

describe("nextDueAt", () => {
  it("fixedTimes: returns the next configured time strictly after `after`", () => {
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["08:00", "20:00"] },
      startDate: "2026-08-01",
    });
    const after = new Date(2026, 7, 10, 10, 0); // between the two times
    const next = nextDueAt(course, [], after);
    expect(next?.toISOString()).toBe(new Date(2026, 7, 10, 20, 0).toISOString());
  });

  it("fixedTimes: rolls over to the next eligible day once past the last time today", () => {
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["08:00", "20:00"] },
      startDate: "2026-08-01",
    });
    const after = new Date(2026, 7, 10, 21, 0); // after both times today
    const next = nextDueAt(course, [], after);
    expect(next?.toISOString()).toBe(new Date(2026, 7, 11, 8, 0).toISOString());
  });

  it("fromLastDose: returns anchor + intervalHours when it is still in the future", () => {
    const course = makeCourse({
      schedule: { kind: "fromLastDose", intervalHours: 8 },
      startDate: "2026-08-01",
    });
    const given = makeEvent({
      courseId: course.id,
      scheduledFor: null,
      status: "given",
      givenAt: "2026-08-10T08:00:00.000Z",
      loggedAt: "2026-08-10T08:00:00.000Z",
    });
    const after = new Date("2026-08-10T09:00:00.000Z");
    const next = nextDueAt(course, [given], after);
    expect(next?.toISOString()).toBe("2026-08-10T16:00:00.000Z");
  });

  it("fromLastDose: an overdue chain (candidate already before `after`) returns null", () => {
    const course = makeCourse({
      schedule: { kind: "fromLastDose", intervalHours: 8 },
      startDate: "2026-08-01",
    });
    const given = makeEvent({
      courseId: course.id,
      scheduledFor: null,
      status: "given",
      givenAt: "2026-08-05T22:00:00.000Z", // candidate lands 2026-08-06T06:00Z, long before `after`
      loggedAt: "2026-08-05T22:00:00.000Z",
    });
    const after = new Date(2026, 7, 10, 10, 0);
    expect(nextDueAt(course, [given], after)).toBeNull();
  });

  it("fromLastDose: a never-started course with anchorTime returns the next anchorTime instant", () => {
    const course = makeCourse({
      schedule: { kind: "fromLastDose", intervalHours: 12, anchorTime: "09:00" },
      startDate: "2026-08-01",
    });
    const after = new Date(2026, 7, 10, 10, 0); // after today's 09:00
    const next = nextDueAt(course, [], after);
    expect(next?.toISOString()).toBe(new Date(2026, 7, 11, 9, 0).toISOString());
  });

  it("fromLastDose: a never-started course without anchorTime returns null", () => {
    const course = makeCourse({
      schedule: { kind: "fromLastDose", intervalHours: 12 },
      startDate: "2026-08-01",
    });
    const after = new Date(2026, 7, 10, 10, 0);
    expect(nextDueAt(course, [], after)).toBeNull();
  });
});

describe("findCoursesToFinish", () => {
  it("returns only active courses whose endDate is fully in the past", () => {
    const now = new Date(2026, 7, 10, 10, 0); // local day 2026-08-10

    const finishable = makeCourse({
      schedule: { kind: "fixedTimes", times: ["08:00"] },
      endDate: "2026-08-09", // fully past
      status: "active",
    });
    const endsToday = makeCourse({
      schedule: { kind: "fixedTimes", times: ["08:00"] },
      endDate: "2026-08-10", // today — not fully past
      status: "active",
    });
    const ongoing = makeCourse({
      schedule: { kind: "fixedTimes", times: ["08:00"] },
      endDate: null,
      status: "active",
    });
    const alreadyStopped = makeCourse({
      schedule: { kind: "fixedTimes", times: ["08:00"] },
      endDate: "2026-08-01",
      status: "stopped",
    });
    const deletedCourse = makeCourse({
      schedule: { kind: "fixedTimes", times: ["08:00"] },
      endDate: "2026-08-01",
      status: "active",
      deletedAt: "2026-08-05T00:00:00.000Z",
    });

    const ctx: EngineContext = {
      courses: [finishable, endsToday, ongoing, alreadyStopped, deletedCourse],
      events: [],
    };

    expect(findCoursesToFinish(ctx, now)).toEqual([finishable.id]);
  });
});
