import { describe, expect, it } from "vitest";
import { occurrenceKeyFor } from "@/domain";
import type { Course, DoseEvent, Schedule } from "@/domain";
import type { EngineContext } from "./engine.types";
import { getOccurrences, isoWeekdayOf, liveEventFor } from "./occurrences";

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
    const ctx: EngineContext = { courses: [course], events: [] };
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
    const ctx: EngineContext = { courses: [course], events: [] };
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
    const ctx: EngineContext = { courses: [course], events: [] };
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
    const ctx: EngineContext = { courses: [course], events: [] };
    expect(getOccurrences("2026-08-09", ctx)).toHaveLength(1);
  });

  it("does not fire a daysOfWeek:[7] course on Monday 2026-08-10", () => {
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["09:00"], daysOfWeek: [7] },
      startDate: "2026-08-01",
    });
    const ctx: EngineContext = { courses: [course], events: [] };
    expect(getOccurrences("2026-08-10", ctx)).toHaveLength(0);
  });

  it("fires a daysOfWeek:[1] course on Monday 2026-08-10 (ISO weekday 1)", () => {
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["09:00"], daysOfWeek: [1] },
      startDate: "2026-08-01",
    });
    const ctx: EngineContext = { courses: [course], events: [] };
    expect(getOccurrences("2026-08-10", ctx)).toHaveLength(1);
  });

  it("does not fire a daysOfWeek:[1] course on Sunday 2026-08-09", () => {
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["09:00"], daysOfWeek: [1] },
      startDate: "2026-08-01",
    });
    const ctx: EngineContext = { courses: [course], events: [] };
    expect(getOccurrences("2026-08-09", ctx)).toHaveLength(0);
  });

  it("counts everyNDays from startDate", () => {
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["09:00"], everyNDays: 3 },
      startDate: "2026-08-01",
    });
    const ctx: EngineContext = { courses: [course], events: [] };
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
    const ctx: EngineContext = { courses: [course], events: [event] };
    expect(getOccurrences("2026-08-05", ctx)).toHaveLength(0);
    expect(ctx.events).toContain(event);
  });

  it("a stopped course generates nothing", () => {
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["09:00"] },
      startDate: "2026-08-01",
      status: "stopped",
    });
    const ctx: EngineContext = { courses: [course], events: [] };
    expect(getOccurrences("2026-08-05", ctx)).toHaveLength(0);
  });

  it("a finished course generates nothing", () => {
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["09:00"] },
      startDate: "2026-08-01",
      status: "finished",
    });
    const ctx: EngineContext = { courses: [course], events: [] };
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
    const ctx: EngineContext = { courses: [course], events: [given] };
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
    const ctx: EngineContext = { courses: [course], events: [given] };
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
    const ctx: EngineContext = { courses: [course], events: [] };
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
    const ctx: EngineContext = { courses: [course], events: [] };
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
