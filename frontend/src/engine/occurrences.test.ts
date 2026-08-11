import { describe, expect, it } from "vitest";
import { atLocalTime, occurrenceKeyFor } from "@/domain";
import type { Course, CourseEvent, DoseEvent, Schedule } from "@/domain";
import type { EngineContext } from "./engine.types";
import { getOccurrences, isoWeekdayOf, liveEventFor } from "./occurrences";
import { getDoseState } from "./state";

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
  return makeScheduleEvent({
    courseId: overrides.courseId,
    at: overrides.at,
    kind: "edited",
    before: { kind: "fixedTimes", times: overrides.before },
    after: { kind: "fixedTimes", times: overrides.after },
  });
}

/** General form: any CourseEventKind, with full `before`/`after` `Schedule`s (so daysOfWeek/everyNDays can be set). */
function makeScheduleEvent(overrides: {
  courseId: string;
  at: string;
  kind: CourseEvent["kind"];
  before: Schedule;
  after: Schedule;
}): CourseEvent {
  courseEventSeq += 1;
  return {
    id: `cev-${courseEventSeq}`,
    courseId: overrides.courseId,
    kind: overrides.kind,
    at: overrides.at,
    seq: courseEventSeq,
    actorId: "test-actor-id",
    before: {
      schedule: overrides.before,
      doseAmount: 1,
      doseUnit: "ml",
      startDate: "2026-08-01",
      endDate: null,
    },
    after: {
      schedule: overrides.after,
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

/** A status-only transition (`paused`/`resumed`/`stopped`/`finished`): `before`/`after` snapshots carry the SAME schedule, since a pure status change never touches it. */
function makeStatusEvent(overrides: {
  courseId: string;
  at: string;
  kind: CourseEvent["kind"];
  schedule: Schedule;
}): CourseEvent {
  return makeScheduleEvent({
    courseId: overrides.courseId,
    at: overrides.at,
    kind: overrides.kind,
    before: overrides.schedule,
    after: overrides.schedule,
  });
}

describe("isoWeekdayOf", () => {
  it("returns 7 for Sunday 2026-08-09 and 1 for Monday 2026-08-10 (ISO numbering, not JS getDay())", () => {
    expect(isoWeekdayOf("2026-08-09")).toBe(7);
    expect(isoWeekdayOf("2026-08-10")).toBe(1);
  });
});

describe("getOccurrences — fixedTimes", () => {
  it("generates one occurrence per entry in times, in ascending dueAt order", () => {
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["08:00", "20:00"] },
      startDate: "2026-08-01",
    });
    const ctx: EngineContext = { courses: [course], events: [], courseEvents: [] };
    const occs = getOccurrences("2026-08-05", ctx);
    expect(occs).toHaveLength(2);
    expect(occs[0].dueAt?.getHours()).toBe(8);
    expect(occs[1].dueAt?.getHours()).toBe(20);
  });

  it("builds occurrence keys with occurrenceKeyFor, never a hand-written template", () => {
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["10:00"] },
      startDate: "2026-08-01",
    });
    const ctx: EngineContext = { courses: [course], events: [], courseEvents: [] };
    const [occ] = getOccurrences("2026-08-05", ctx);
    expect(occ.dueAt).not.toBeNull();
    expect(occ.key).toBe(occurrenceKeyFor(course.id, occ.dueAt!.toISOString()));
  });

  it("respects the [startDate, endDate] window: nothing before start, present on start, present on end, nothing after end", () => {
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["09:00"] },
      startDate: "2026-08-05",
      endDate: "2026-08-07",
    });
    const ctx: EngineContext = { courses: [course], events: [], courseEvents: [] };
    expect(getOccurrences("2026-08-04", ctx)).toHaveLength(0);
    expect(getOccurrences("2026-08-05", ctx)).toHaveLength(1);
    expect(getOccurrences("2026-08-07", ctx)).toHaveLength(1);
    expect(getOccurrences("2026-08-08", ctx)).toHaveLength(0);
  });

  it("fires a daysOfWeek:[7] course on Sunday 2026-08-09 (ISO weekday 7)", () => {
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["09:00"], daysOfWeek: [7] },
      startDate: "2026-08-01",
    });
    const ctx: EngineContext = { courses: [course], events: [], courseEvents: [] };
    expect(getOccurrences("2026-08-09", ctx)).toHaveLength(1);
  });

  it("does not fire a daysOfWeek:[7] course on Monday 2026-08-10", () => {
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["09:00"], daysOfWeek: [7] },
      startDate: "2026-08-01",
    });
    const ctx: EngineContext = { courses: [course], events: [], courseEvents: [] };
    expect(getOccurrences("2026-08-10", ctx)).toHaveLength(0);
  });

  it("fires a daysOfWeek:[1] course on Monday 2026-08-10 (ISO weekday 1)", () => {
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["09:00"], daysOfWeek: [1] },
      startDate: "2026-08-01",
    });
    const ctx: EngineContext = { courses: [course], events: [], courseEvents: [] };
    expect(getOccurrences("2026-08-10", ctx)).toHaveLength(1);
  });

  it("does not fire a daysOfWeek:[1] course on Sunday 2026-08-09", () => {
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["09:00"], daysOfWeek: [1] },
      startDate: "2026-08-01",
    });
    const ctx: EngineContext = { courses: [course], events: [], courseEvents: [] };
    expect(getOccurrences("2026-08-09", ctx)).toHaveLength(0);
  });

  it("counts everyNDays from startDate", () => {
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["09:00"], everyNDays: 3 },
      startDate: "2026-08-01",
    });
    const ctx: EngineContext = { courses: [course], events: [], courseEvents: [] };
    expect(getOccurrences("2026-08-01", ctx)).toHaveLength(1); // day offset 0
    expect(getOccurrences("2026-08-02", ctx)).toHaveLength(0); // day offset 1
    expect(getOccurrences("2026-08-03", ctx)).toHaveLength(0); // day offset 2
    expect(getOccurrences("2026-08-04", ctx)).toHaveLength(1); // day offset 3
  });

  it("a paused course generates nothing while its events stay present in ctx.events (SPEC §11 case 4)", () => {
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["09:00"] },
      startDate: "2026-08-01",
      status: "paused",
    });
    const event = makeEvent({ courseId: course.id, scheduledFor: "2026-08-05T08:00:00.000Z" });
    const ctx: EngineContext = { courses: [course], events: [event], courseEvents: [] };
    expect(getOccurrences("2026-08-05", ctx)).toHaveLength(0);
    expect(ctx.events).toContain(event);
  });

  it("a stopped course generates nothing", () => {
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["09:00"] },
      startDate: "2026-08-01",
      status: "stopped",
    });
    const ctx: EngineContext = { courses: [course], events: [], courseEvents: [] };
    expect(getOccurrences("2026-08-05", ctx)).toHaveLength(0);
  });

  it("a finished course generates nothing", () => {
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["09:00"] },
      startDate: "2026-08-01",
      status: "finished",
    });
    const ctx: EngineContext = { courses: [course], events: [], courseEvents: [] };
    expect(getOccurrences("2026-08-05", ctx)).toHaveLength(0);
  });
});

describe("getOccurrences — fromLastDose", () => {
  it("emits the anchored occurrence only on the local day the chain lands on", () => {
    const course = makeCourse({
      schedule: { kind: "fromLastDose", intervalHours: 8 },
      startDate: "2026-08-01",
    });
    const given = makeEvent({
      courseId: course.id,
      scheduledFor: null,
      status: "given",
      givenAt: "2026-08-05T22:00:00.000Z", // 23:00 BST
      loggedAt: "2026-08-05T22:00:00.000Z",
    });
    const ctx: EngineContext = { courses: [course], events: [given], courseEvents: [] };
    // Anchor 2026-08-05T22:00Z + 8h = 2026-08-06T06:00Z = 07:00 BST on 2026-08-06.
    expect(getOccurrences("2026-08-05", ctx)).toHaveLength(0);
    const onDay = getOccurrences("2026-08-06", ctx);
    expect(onDay).toHaveLength(1);
    expect(onDay[0].dueAt?.toISOString()).toBe("2026-08-06T06:00:00.000Z");
    expect(getOccurrences("2026-08-07", ctx)).toHaveLength(0);
  });

  it("anchors from resumedAt when it is later than the last given event", () => {
    const course = makeCourse({
      schedule: { kind: "fromLastDose", intervalHours: 8 },
      startDate: "2026-08-01",
      resumedAt: "2026-08-06T10:00:00.000Z",
    });
    const given = makeEvent({
      courseId: course.id,
      scheduledFor: null,
      status: "given",
      givenAt: "2026-08-05T22:00:00.000Z",
      loggedAt: "2026-08-05T22:00:00.000Z",
    });
    const ctx: EngineContext = { courses: [course], events: [given], courseEvents: [] };
    // Anchor should be resumedAt (10:00Z Aug 6), not the earlier givenAt.
    // 10:00Z + 8h = 18:00Z, same day.
    const occs = getOccurrences("2026-08-06", ctx);
    expect(occs).toHaveLength(1);
    expect(occs[0].dueAt?.toISOString()).toBe("2026-08-06T18:00:00.000Z");
  });

  it("never-started fromLastDose with anchorTime seeds a display dueAt and the '|-' key", () => {
    const course = makeCourse({
      schedule: { kind: "fromLastDose", intervalHours: 12, anchorTime: "09:00" },
      startDate: "2026-08-01",
    });
    const ctx: EngineContext = { courses: [course], events: [], courseEvents: [] };
    const occs = getOccurrences("2026-08-05", ctx);
    expect(occs).toHaveLength(1);
    expect(occs[0].key).toBe(occurrenceKeyFor(course.id, null));
    expect(occs[0].dueAt?.getHours()).toBe(9);
    expect(occs[0].event).toBeNull();
  });

  it("never-started fromLastDose without anchorTime has dueAt: null", () => {
    const course = makeCourse({
      schedule: { kind: "fromLastDose", intervalHours: 12 },
      startDate: "2026-08-01",
    });
    const ctx: EngineContext = { courses: [course], events: [], courseEvents: [] };
    const occs = getOccurrences("2026-08-05", ctx);
    expect(occs).toHaveLength(1);
    expect(occs[0].key).toBe(occurrenceKeyFor(course.id, null));
    expect(occs[0].dueAt).toBeNull();
  });
});

describe("liveEventFor", () => {
  it("ignores soft-deleted and superseded events and returns the newest live candidate by loggedAt", () => {
    const courseId = "course-live";
    const scheduledFor = "2026-08-05T08:00:00.000Z";
    const key = occurrenceKeyFor(courseId, scheduledFor);

    const deleted = makeEvent({
      id: "e-deleted",
      courseId,
      scheduledFor,
      loggedAt: "2026-08-05T08:05:00.000Z",
      deletedAt: "2026-08-05T09:00:00.000Z",
    });
    const superseded = makeEvent({
      id: "e-superseded",
      courseId,
      scheduledFor,
      loggedAt: "2026-08-05T08:10:00.000Z",
    });
    const correction = makeEvent({
      id: "e-correction",
      courseId,
      scheduledFor,
      loggedAt: "2026-08-05T09:00:00.000Z",
      supersedesId: "e-superseded",
    });
    const newest = makeEvent({
      id: "e-newest",
      courseId,
      scheduledFor,
      loggedAt: "2026-08-05T09:30:00.000Z",
    });

    const events = [deleted, superseded, correction, newest];
    expect(liveEventFor(key, events)?.id).toBe("e-newest");
  });

  it("returns null when there is no live candidate for the key", () => {
    expect(liveEventFor(occurrenceKeyFor("course-x", null), [])).toBeNull();
  });
});

// SPEC §3c: editing a fixedTimes schedule is forward-only. An occurrence is
// generated from the schedule that was in effect at its OWN due instant, per
// the CourseEvent ledger — never from the live `course.schedule` alone.
describe("getOccurrences — fixedTimes schedule edits are forward-only (SPEC §3c)", () => {
  it("past-day invariant: a day before the edit still projects the OLD grid, and a stored event on it still resolves", () => {
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["08:00", "18:00"] }, // live/current = NEW grid
      startDate: "2026-08-01",
    });
    const edited = makeEditedEvent({
      courseId: course.id,
      at: atLocalTime("2026-08-10", "13:00").toISOString(),
      before: ["08:00", "20:00"],
      after: ["08:00", "18:00"],
    });
    const givenOnOldGrid = makeEvent({
      courseId: course.id,
      scheduledFor: atLocalTime("2026-08-09", "20:00").toISOString(),
    });
    const ctx: EngineContext = {
      courses: [course],
      events: [givenOnOldGrid],
      courseEvents: [edited],
    };

    const occs = getOccurrences("2026-08-09", ctx);
    expect(occs).toHaveLength(2);
    const evening = occs.find((o) => o.dueAt?.getHours() !== 8)!;
    expect(evening.dueAt?.toISOString()).toBe(atLocalTime("2026-08-09", "20:00").toISOString());
    expect(evening.key).toBe(occurrenceKeyFor(course.id, atLocalTime("2026-08-09", "20:00").toISOString()));
    expect(evening.event).not.toBeNull();
    expect(evening.event?.id).toBe(givenOnOldGrid.id);
  });

  it("any day before the edit: whole OLD grid", () => {
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["08:00", "18:00"] },
      startDate: "2026-08-01",
    });
    const edited = makeEditedEvent({
      courseId: course.id,
      at: atLocalTime("2026-08-10", "13:00").toISOString(),
      before: ["08:00", "20:00"],
      after: ["08:00", "18:00"],
    });
    const ctx: EngineContext = { courses: [course], events: [], courseEvents: [edited] };

    const occs = getOccurrences("2026-08-05", ctx);
    expect(occs.map((o) => o.dueAt?.toISOString()).sort()).toEqual(
      [atLocalTime("2026-08-05", "08:00"), atLocalTime("2026-08-05", "20:00")]
        .map((d) => d.toISOString())
        .sort(),
    );
  });

  it("any day after the edit: whole NEW grid", () => {
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["08:00", "18:00"] },
      startDate: "2026-08-01",
    });
    const edited = makeEditedEvent({
      courseId: course.id,
      at: atLocalTime("2026-08-10", "13:00").toISOString(),
      before: ["08:00", "20:00"],
      after: ["08:00", "18:00"],
    });
    const ctx: EngineContext = { courses: [course], events: [], courseEvents: [edited] };

    const occs = getOccurrences("2026-08-15", ctx);
    expect(occs.map((o) => o.dueAt?.toISOString()).sort()).toEqual(
      [atLocalTime("2026-08-15", "08:00"), atLocalTime("2026-08-15", "18:00")]
        .map((d) => d.toISOString())
        .sort(),
    );
  });

  it("edit at 14:00 with 08:00 already given, 20:00→18:00: {08:00 given, 18:00 pending}", () => {
    const day = "2026-08-10";
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["08:00", "18:00"] },
      startDate: "2026-08-01",
    });
    const edited = makeEditedEvent({
      courseId: course.id,
      at: atLocalTime(day, "14:00").toISOString(),
      before: ["08:00", "20:00"],
      after: ["08:00", "18:00"],
    });
    const given0800 = makeEvent({
      courseId: course.id,
      scheduledFor: atLocalTime(day, "08:00").toISOString(),
    });
    const ctx: EngineContext = {
      courses: [course],
      events: [given0800],
      courseEvents: [edited],
    };

    const occs = getOccurrences(day, ctx);
    expect(occs).toHaveLength(2);
    const morning = occs.find((o) => o.dueAt?.getHours() === 8)!;
    const evening = occs.find((o) => o.dueAt?.getHours() !== 8)!;
    expect(morning.event?.id).toBe(given0800.id);
    expect(evening.dueAt?.toISOString()).toBe(atLocalTime(day, "18:00").toISOString());
    expect(evening.event).toBeNull();
  });

  it("edit at 19:00, 20:00→18:00, nothing given: the slot moves into the past and reads overdue, never lost", () => {
    const day = "2026-08-10";
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["18:00"] },
      startDate: "2026-08-01",
    });
    const edited = makeEditedEvent({
      courseId: course.id,
      at: atLocalTime(day, "19:00").toISOString(),
      before: ["20:00"],
      after: ["18:00"],
    });
    const ctx: EngineContext = { courses: [course], events: [], courseEvents: [edited] };

    const occs = getOccurrences(day, ctx);
    expect(occs).toHaveLength(1);
    expect(occs[0].dueAt?.toISOString()).toBe(atLocalTime(day, "18:00").toISOString());
    expect(occs[0].event).toBeNull();
    expect(getDoseState(occs[0], atLocalTime(day, "20:00"))).toBe("overdue");
  });

  it("edit at 21:00 with 20:00 already given at 20:05, →18:00: the slot STAYS 20:00 and no phantom 18:00 row appears", () => {
    const day = "2026-08-10";
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["18:00"] },
      startDate: "2026-08-01",
    });
    const edited = makeEditedEvent({
      courseId: course.id,
      at: atLocalTime(day, "21:00").toISOString(),
      before: ["20:00"],
      after: ["18:00"],
    });
    const given2000 = makeEvent({
      courseId: course.id,
      scheduledFor: atLocalTime(day, "20:00").toISOString(),
      givenAt: atLocalTime(day, "20:05").toISOString(),
      loggedAt: atLocalTime(day, "20:05").toISOString(),
    });
    const ctx: EngineContext = {
      courses: [course],
      events: [given2000],
      courseEvents: [edited],
    };

    const occs = getOccurrences(day, ctx);
    expect(occs).toHaveLength(1);
    expect(occs[0].dueAt?.toISOString()).toBe(atLocalTime(day, "20:00").toISOString());
    expect(occs[0].event?.id).toBe(given2000.id);
  });

  it("slot count 2→3 on the transition day: the surplus new slot appears once it is itself due", () => {
    const day = "2026-08-10";
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["08:00", "18:00", "22:00"] },
      startDate: "2026-08-01",
    });
    const edited = makeEditedEvent({
      courseId: course.id,
      at: atLocalTime(day, "09:00").toISOString(),
      before: ["08:00", "20:00"],
      after: ["08:00", "18:00", "22:00"],
    });
    const ctx: EngineContext = { courses: [course], events: [], courseEvents: [edited] };

    const occs = getOccurrences(day, ctx);
    expect(occs.map((o) => o.dueAt?.toISOString())).toEqual(
      ["08:00", "18:00", "22:00"].map((t) => atLocalTime(day, t).toISOString()),
    );
  });

  it("slot count 3→2 on the transition day: the removed slot vanishes without ever having fired", () => {
    const day = "2026-08-10";
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["08:00", "18:00"] },
      startDate: "2026-08-01",
    });
    const edited = makeEditedEvent({
      courseId: course.id,
      at: atLocalTime(day, "10:00").toISOString(),
      before: ["08:00", "14:00", "20:00"],
      after: ["08:00", "18:00"],
    });
    const ctx: EngineContext = { courses: [course], events: [], courseEvents: [edited] };

    const occs = getOccurrences(day, ctx);
    expect(occs.map((o) => o.dueAt?.toISOString())).toEqual(
      ["08:00", "18:00"].map((t) => atLocalTime(day, t).toISOString()),
    );
  });
});

// Regression coverage for the "second same-day edit never consulted" bug:
// `fixedTimesOccurrences` used to pin the whole day on a binary old/new
// split from only the SINGLE earliest CourseEvent after dayStart. A second
// edit landing later the same day was silently invisible.
describe("getOccurrences — fixedTimes, N same-day transitions are all folded in (SPEC §3c)", () => {
  it("two same-day edits: the evening slot ends up on the SECOND edit's grid, not the first's (reviewer's exact repro)", () => {
    const day = "2026-08-10";
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["12:00", "21:00"] }, // live = final grid
      startDate: "2026-08-01",
    });
    const edit1 = makeEditedEvent({
      courseId: course.id,
      at: atLocalTime(day, "09:00").toISOString(),
      before: ["08:00", "20:00"],
      after: ["10:00", "20:00"],
    });
    const edit2 = makeEditedEvent({
      courseId: course.id,
      at: atLocalTime(day, "11:00").toISOString(),
      before: ["10:00", "20:00"],
      after: ["12:00", "21:00"],
    });
    const ctx: EngineContext = { courses: [course], events: [], courseEvents: [edit1, edit2] };

    const occs = getOccurrences(day, ctx);
    expect(occs).toHaveLength(2);
    const evening = occs.find((o) => o.dueAt!.getHours() >= 18)!;
    // Before the fix this asserted (and produced) 20:00 — edit2 was never
    // consulted because `firstCourseEventAfter` only ever returns the
    // single earliest event after dayStart.
    expect(evening.dueAt?.toISOString()).toBe(atLocalTime(day, "21:00").toISOString());
    expect(evening.key).toBe(occurrenceKeyFor(course.id, atLocalTime(day, "21:00").toISOString()));
  });

  it("three same-day transitions: a single slot walks all three grids in order, not just the first two", () => {
    const day = "2026-08-10";
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["11:00"] },
      startDate: "2026-08-01",
    });
    const edit1 = makeEditedEvent({
      courseId: course.id,
      at: atLocalTime(day, "06:00").toISOString(),
      before: ["08:00"],
      after: ["09:00"],
    });
    const edit2 = makeEditedEvent({
      courseId: course.id,
      at: atLocalTime(day, "07:00").toISOString(),
      before: ["09:00"],
      after: ["10:00"],
    });
    const edit3 = makeEditedEvent({
      courseId: course.id,
      at: atLocalTime(day, "07:30").toISOString(),
      before: ["10:00"],
      after: ["11:00"],
    });
    const ctx: EngineContext = { courses: [course], events: [], courseEvents: [edit1, edit2, edit3] };

    const occs = getOccurrences(day, ctx);
    expect(occs).toHaveLength(1);
    // A fold stopping after 2 transitions would land on 10:00, not 11:00.
    expect(occs[0].dueAt?.toISOString()).toBe(atLocalTime(day, "11:00").toISOString());
  });

  it("two edits on DIFFERENT days: each day projects only the transition(s) that actually land within it", () => {
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["08:00", "16:00"] }, // live = final grid
      startDate: "2026-08-01",
    });
    const edit1 = makeEditedEvent({
      courseId: course.id,
      at: atLocalTime("2026-08-10", "09:00").toISOString(),
      before: ["08:00", "20:00"],
      after: ["08:00", "18:00"],
    });
    const edit2 = makeEditedEvent({
      courseId: course.id,
      at: atLocalTime("2026-08-12", "09:00").toISOString(),
      before: ["08:00", "18:00"],
      after: ["08:00", "16:00"],
    });
    const ctx: EngineContext = { courses: [course], events: [], courseEvents: [edit1, edit2] };

    const before = getOccurrences("2026-08-09", ctx);
    expect(before.map((o) => o.dueAt?.toISOString()).sort()).toEqual(
      ["08:00", "20:00"].map((t) => atLocalTime("2026-08-09", t).toISOString()).sort(),
    );

    const edit1Day = getOccurrences("2026-08-10", ctx);
    const edit1Evening = edit1Day.find((o) => o.dueAt!.getHours() !== 8)!;
    expect(edit1Evening.dueAt?.toISOString()).toBe(atLocalTime("2026-08-10", "18:00").toISOString());

    const between = getOccurrences("2026-08-11", ctx);
    expect(between.map((o) => o.dueAt?.toISOString()).sort()).toEqual(
      ["08:00", "18:00"].map((t) => atLocalTime("2026-08-11", t).toISOString()).sort(),
    );

    const edit2Day = getOccurrences("2026-08-12", ctx);
    const edit2Evening = edit2Day.find((o) => o.dueAt!.getHours() !== 8)!;
    expect(edit2Evening.dueAt?.toISOString()).toBe(atLocalTime("2026-08-12", "16:00").toISOString());

    const after = getOccurrences("2026-08-13", ctx);
    expect(after.map((o) => o.dueAt?.toISOString()).sort()).toEqual(
      ["08:00", "16:00"].map((t) => atLocalTime("2026-08-13", t).toISOString()).sort(),
    );
  });

  it("mixed-kind ledger: an edited event followed by paused/resumed still resolves correctly on a day between the latter two", () => {
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["08:00", "18:00"] },
      startDate: "2026-08-01",
      status: "active", // resumed most recently — SPEC §11: status is live, not day-historical
    });
    const schedule: Schedule = { kind: "fixedTimes", times: ["08:00", "18:00"] };
    const edited = makeEditedEvent({
      courseId: course.id,
      at: atLocalTime("2026-08-10", "09:00").toISOString(),
      before: ["08:00", "20:00"],
      after: ["08:00", "18:00"],
    });
    const paused = makeStatusEvent({
      courseId: course.id,
      at: atLocalTime("2026-08-12", "10:00").toISOString(),
      kind: "paused",
      schedule,
    });
    const resumed = makeStatusEvent({
      courseId: course.id,
      at: atLocalTime("2026-08-14", "10:00").toISOString(),
      kind: "resumed",
      schedule,
    });
    const ctx: EngineContext = {
      courses: [course],
      events: [],
      courseEvents: [edited, paused, resumed],
    };

    // 2026-08-13 falls between `paused` and `resumed` — resolving it requires
    // walking PAST both non-"edited" events to find the schedule they both
    // carry, proving the timeline walk isn't quietly `kind === "edited"`-only.
    const occs = getOccurrences("2026-08-13", ctx);
    expect(occs.map((o) => o.dueAt?.toISOString()).sort()).toEqual(
      ["08:00", "18:00"].map((t) => atLocalTime("2026-08-13", t).toISOString()).sort(),
    );
  });
});

// SPEC §3c generalizes to eligibility, not just clock time: a slot's
// daysOfWeek/everyNDays eligibility is governed by whichever schedule
// version was in effect at ITS OWN due instant — not by whatever version
// governed the day as a whole at dayStart. Covers both directions (a same-
// day edit can make a slot newly eligible, or newly ineligible) for both
// daysOfWeek and everyNDays.
describe("getOccurrences — fixedTimes, per-slot eligibility on a same-day transition (SPEC §3c)", () => {
  it("daysOfWeek: eligible under OLD, ineligible under NEW — only the pre-edit slot survives", () => {
    const day = "2026-08-10"; // Monday, ISO weekday 1
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["08:00", "18:00"], daysOfWeek: [2] },
      startDate: "2026-08-01",
    });
    const edited = makeScheduleEvent({
      courseId: course.id,
      at: atLocalTime(day, "09:00").toISOString(),
      kind: "edited",
      before: { kind: "fixedTimes", times: ["08:00", "20:00"], daysOfWeek: [1] }, // Monday: eligible
      after: { kind: "fixedTimes", times: ["08:00", "18:00"], daysOfWeek: [2] }, // Tuesday only: ineligible
    });
    const ctx: EngineContext = { courses: [course], events: [], courseEvents: [edited] };

    const occs = getOccurrences(day, ctx);
    expect(occs).toHaveLength(1);
    expect(occs[0].dueAt?.toISOString()).toBe(atLocalTime(day, "08:00").toISOString());
  });

  it("daysOfWeek: ineligible under OLD, eligible under NEW — only the post-edit slot appears", () => {
    const day = "2026-08-10"; // Monday, ISO weekday 1
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["10:00", "21:00"], daysOfWeek: [1] },
      startDate: "2026-08-01",
    });
    const edited = makeScheduleEvent({
      courseId: course.id,
      at: atLocalTime(day, "09:00").toISOString(),
      kind: "edited",
      before: { kind: "fixedTimes", times: ["08:00", "20:00"], daysOfWeek: [2] }, // Tuesday only: ineligible
      after: { kind: "fixedTimes", times: ["10:00", "21:00"], daysOfWeek: [1] }, // Monday: eligible
    });
    const ctx: EngineContext = { courses: [course], events: [], courseEvents: [edited] };

    const occs = getOccurrences(day, ctx);
    expect(occs).toHaveLength(1);
    expect(occs[0].dueAt?.toISOString()).toBe(atLocalTime(day, "21:00").toISOString());
  });

  it("everyNDays: eligible under OLD, ineligible under NEW — only the pre-edit slot survives", () => {
    const day = "2026-08-04"; // offset 3 from startDate
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["08:00", "18:00"], everyNDays: 2 },
      startDate: "2026-08-01",
    });
    const edited = makeScheduleEvent({
      courseId: course.id,
      at: atLocalTime(day, "09:00").toISOString(),
      kind: "edited",
      before: { kind: "fixedTimes", times: ["08:00", "20:00"], everyNDays: 3 }, // offset 3 % 3 === 0: eligible
      after: { kind: "fixedTimes", times: ["08:00", "18:00"], everyNDays: 2 }, // offset 3 % 2 !== 0: ineligible
    });
    const ctx: EngineContext = { courses: [course], events: [], courseEvents: [edited] };

    const occs = getOccurrences(day, ctx);
    expect(occs).toHaveLength(1);
    expect(occs[0].dueAt?.toISOString()).toBe(atLocalTime(day, "08:00").toISOString());
  });

  it("everyNDays: ineligible under OLD, eligible under NEW — only the post-edit slot appears", () => {
    const day = "2026-08-04"; // offset 3 from startDate
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["10:00", "21:00"], everyNDays: 3 },
      startDate: "2026-08-01",
    });
    const edited = makeScheduleEvent({
      courseId: course.id,
      at: atLocalTime(day, "09:00").toISOString(),
      kind: "edited",
      before: { kind: "fixedTimes", times: ["08:00", "20:00"], everyNDays: 2 }, // offset 3 % 2 !== 0: ineligible
      after: { kind: "fixedTimes", times: ["10:00", "21:00"], everyNDays: 3 }, // offset 3 % 3 === 0: eligible
    });
    const ctx: EngineContext = { courses: [course], events: [], courseEvents: [edited] };

    const occs = getOccurrences(day, ctx);
    expect(occs).toHaveLength(1);
    expect(occs[0].dueAt?.toISOString()).toBe(atLocalTime(day, "21:00").toISOString());
  });
});
