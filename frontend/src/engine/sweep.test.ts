import { describe, expect, it } from "vitest";
import { addLocalDays, atLocalTime, localDayKey, occurrenceKeyFor } from "@/domain";
import type { Course, CourseEvent, DoseEvent, LocalDate, Schedule } from "@/domain";
import type { EngineContext } from "./engine.types";
import { getOccurrences } from "./occurrences";
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

let courseEventSeq = 0;
/** An `edited` CourseEvent shifting `fixedTimes.times` from `before` to `after` at `at`. */
function makeEditedEvent(overrides: {
  courseId: string;
  at: string;
  before: string[];
  after: string[];
}): CourseEvent {
  courseEventSeq += 1;
  return {
    id: `cev-${courseEventSeq}`,
    courseId: overrides.courseId,
    kind: "edited",
    at: overrides.at,
    seq: courseEventSeq,
    actorId: "test-actor-id",
    before: {
      schedule: { kind: "fixedTimes", times: overrides.before },
      doseAmount: 1,
      doseUnit: "ml",
      startDate: "2026-08-01",
      endDate: null,
    },
    after: {
      schedule: { kind: "fixedTimes", times: overrides.after },
      doseAmount: 1,
      doseUnit: "ml",
      startDate: "2026-08-01",
      endDate: null,
    },
    createdAt: overrides.at,
    updatedAt: overrides.at,
    deletedAt: null,
  };
}

/** The earliest `dueAt > after` across `getOccurrences`, scanning day by day — the reference implementation `nextDueAt` is checked against. */
function earliestOccurrenceAfter(ctx: EngineContext, after: Date): Date | null {
  let day: LocalDate = localDayKey(after);
  for (let i = 0; i < 400; i++) {
    for (const occ of getOccurrences(day, ctx)) {
      if (occ.dueAt !== null && occ.dueAt.getTime() > after.getTime()) return occ.dueAt;
    }
    day = addLocalDays(day, 1);
  }
  return null;
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
    const ctx: EngineContext = { courses: [course], events: [], courseEvents: [] };
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
    const ctx: EngineContext = { courses: [course], events: [], courseEvents: [] };
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
    const ctx: EngineContext = { courses: [course], events: [given], courseEvents: [] };
    const now = new Date(2026, 7, 10, 10, 0);
    expect(findMissedOccurrences(ctx, now)).toHaveLength(0);
  });

  it("is idempotent across a 7-day x N-slot matrix: every 'missed' occurrence found in one pass is not found again in the next", () => {
    // 7 days, 3 slots/day — the regression this guards ("write what the
    // sweep found, then find it again") is a full week's worth of candidates
    // at once, not one course / one slot / one day.
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["08:00", "14:00", "20:00"] },
      startDate: "2026-08-03",
      endDate: "2026-08-09",
    });
    const now = new Date(2026, 7, 10, 10, 0); // well over 12h past every slot in the window

    const ctxBefore: EngineContext = { courses: [course], events: [], courseEvents: [] };
    const missedBefore = findMissedOccurrences(ctxBefore, now);
    expect(missedBefore).toHaveLength(7 * 3);

    // Write what the sweep found as `missed` DoseEvents — what `recordMissed`
    // would do with this pass's output.
    const missedEvents: DoseEvent[] = missedBefore.map((occ) =>
      makeEvent({
        courseId: occ.courseId,
        scheduledFor: occ.dueAt!.toISOString(),
        status: "missed",
        loggedAt: now.toISOString(),
        givenAt: now.toISOString(),
      }),
    );

    const ctxAfter: EngineContext = { courses: [course], events: missedEvents, courseEvents: [] };
    expect(findMissedOccurrences(ctxAfter, now)).toHaveLength(0);
  });

  it("defaults lookbackDays to 7: an occurrence 8 days ago is not found", () => {
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["08:00"] },
      startDate: "2026-08-02",
      endDate: "2026-08-02",
    });
    const ctx: EngineContext = { courses: [course], events: [], courseEvents: [] };
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
    const ctx: EngineContext = { courses: [today, yesterday], events: [], courseEvents: [] };
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
      const ctx: EngineContext = { courses: [today], events: [], courseEvents: [] };
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
    const next = nextDueAt(course, [], [], after);
    expect(next?.toISOString()).toBe(new Date(2026, 7, 10, 20, 0).toISOString());
  });

  it("fixedTimes: rolls over to the next eligible day once past the last time today", () => {
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["08:00", "20:00"] },
      startDate: "2026-08-01",
    });
    const after = new Date(2026, 7, 10, 21, 0); // after both times today
    const next = nextDueAt(course, [], [], after);
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
    const next = nextDueAt(course, [given], [], after);
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
    expect(nextDueAt(course, [given], [], after)).toBeNull();
  });

  it("fromLastDose: a never-started course with anchorTime returns the next anchorTime instant", () => {
    const course = makeCourse({
      schedule: { kind: "fromLastDose", intervalHours: 12, anchorTime: "09:00" },
      startDate: "2026-08-01",
    });
    const after = new Date(2026, 7, 10, 10, 0); // after today's 09:00
    const next = nextDueAt(course, [], [], after);
    expect(next?.toISOString()).toBe(new Date(2026, 7, 11, 9, 0).toISOString());
  });

  it("fromLastDose: a never-started course without anchorTime returns null", () => {
    const course = makeCourse({
      schedule: { kind: "fromLastDose", intervalHours: 12 },
      startDate: "2026-08-01",
    });
    const after = new Date(2026, 7, 10, 10, 0);
    expect(nextDueAt(course, [], [], after)).toBeNull();
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
      courseEvents: [],
    };

    expect(findCoursesToFinish(ctx, now)).toEqual([finishable.id]);
  });
});

// SPEC §3c: this is the direct regression test for the phantom-rows bug —
// sweeping, writing what was found, then applying a schedule edit must not
// make the sweep find those same past occurrences "missed" all over again.
describe("findMissedOccurrences is idempotent across a schedule edit (SPEC §3c)", () => {
  it("re-running the sweep after recording missed events and then editing the schedule finds zero new candidates", () => {
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["08:00"] },
      startDate: "2026-08-08",
      endDate: "2026-08-08",
    });
    const now = new Date(2026, 7, 10, 10, 0); // well over 12h past the single 08:00 occurrence

    const ctxBeforeEdit: EngineContext = { courses: [course], events: [], courseEvents: [] };
    const missedBefore = findMissedOccurrences(ctxBeforeEdit, now);
    expect(missedBefore).toHaveLength(1);

    // Write what the sweep found as `missed` DoseEvents — what W1's
    // `recordMissed` would do with this pass's output.
    const missedEvents: DoseEvent[] = missedBefore.map((occ) =>
      makeEvent({
        courseId: occ.courseId,
        scheduledFor: occ.dueAt!.toISOString(),
        status: "missed",
        loggedAt: now.toISOString(),
        givenAt: now.toISOString(),
      }),
    );

    // Now the schedule is edited — 08:00 becomes 10:00 — with the ledger
    // entry recording it, effective from `now` onward.
    const editedCourse: Course = { ...course, schedule: { kind: "fixedTimes", times: ["10:00"] } };
    const edited = makeEditedEvent({
      courseId: course.id,
      at: now.toISOString(),
      before: ["08:00"],
      after: ["10:00"],
    });

    const ctxAfterEdit: EngineContext = {
      courses: [editedCourse],
      events: missedEvents,
      courseEvents: [edited],
    };
    const missedAfter = findMissedOccurrences(ctxAfterEdit, now);
    expect(missedAfter).toHaveLength(0);

    // The past day's occurrence still carries the SAME key, still resolved
    // by the missed event just written — no drift, no orphan.
    const occsAfter = getOccurrences(missedBefore[0].day, ctxAfterEdit);
    const matched = occsAfter.find((o) => o.key === missedBefore[0].key);
    expect(matched).toBeDefined();
    expect(matched?.event?.id).toBe(missedEvents[0].id);
  });
});

describe("nextDueAt agrees with getOccurrences across a schedule edit (property, SPEC §3c)", () => {
  it("equals the earliest getOccurrences entry with dueAt > after, for several afters straddling the edit", () => {
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["08:00", "18:00"] },
      startDate: "2026-08-01",
    });
    const changedAt = atLocalTime("2026-08-10", "14:00");
    const edited = makeEditedEvent({
      courseId: course.id,
      at: changedAt.toISOString(),
      before: ["08:00", "20:00"],
      after: ["08:00", "18:00"],
    });
    const ctx: EngineContext = { courses: [course], events: [], courseEvents: [edited] };

    const afters = [
      atLocalTime("2026-08-08", "09:00"), // well before the edit
      atLocalTime("2026-08-10", "07:00"), // edit day, before the morning slot
      atLocalTime("2026-08-10", "13:59"), // edit day, just before the edit
      atLocalTime("2026-08-10", "19:00"), // edit day, after the edit
      atLocalTime("2026-08-12", "09:00"), // well after the edit
    ];

    for (const after of afters) {
      const next = nextDueAt(course, [], [edited], after);
      const reference = earliestOccurrenceAfter(ctx, after);
      expect(next?.toISOString() ?? null).toBe(reference?.toISOString() ?? null);
    }
  });
});
