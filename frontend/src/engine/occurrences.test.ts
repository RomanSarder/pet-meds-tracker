import { describe, expect, it } from "vitest";
import { atLocalTime, occurrenceKeyFor } from "@/domain";
import type { Course, CourseEvent, DoseEvent, Schedule } from "@/domain";
import type { EngineContext } from "./engine.types";
import { anchorFor, getOccurrences, isoWeekdayOf, liveEventFor } from "./occurrences";
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
  it("emits the anchored occurrence on every day from the anchor's day through the due day (early-give reachability), and no further", () => {
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
    // The chain re-anchored on 2026-08-05 (BST), so the SAME occurrence — same
    // key, same dueAt — is already visible (and giveable early) that day, not
    // only once its due instant crosses into 2026-08-06.
    const onAnchorDay = getOccurrences("2026-08-05", ctx);
    expect(onAnchorDay).toHaveLength(1);
    expect(onAnchorDay[0].dueAt?.toISOString()).toBe("2026-08-06T06:00:00.000Z");
    const onDay = getOccurrences("2026-08-06", ctx);
    expect(onDay).toHaveLength(1);
    expect(onDay[0].dueAt?.toISOString()).toBe("2026-08-06T06:00:00.000Z");
    expect(onDay[0].key).toBe(onAnchorDay[0].key);
    // Still outstanding the next day, so it survives — see the dedicated
    // "does not vanish" cases below for why.
    const dayAfter = getOccurrences("2026-08-07", ctx);
    expect(dayAfter).toHaveLength(1);
    expect(dayAfter[0].key).toBe(onDay[0].key);
  });

  // The reported bug: "a new day came and one of my pets did not reset — I
  // can't give his meds, he shows as completed". An interval dose that came
  // due yesterday and was never logged used to stop generating at midnight.
  // The chain only re-anchors on a `given` event, so `dueAt` stayed put in
  // the past and no later day produced anything: the course disappeared off
  // Today entirely, leaving the pet with nothing to give.
  it("keeps emitting an OUTSTANDING overdue dose on later days, so the course cannot vanish overnight", () => {
    const course = makeCourse({
      schedule: { kind: "fromLastDose", intervalHours: 8 },
      startDate: "2026-08-01",
    });
    const given = makeEvent({
      courseId: course.id,
      scheduledFor: null,
      status: "given",
      givenAt: "2026-08-05T13:00:00.000Z", // 14:00 BST on the 5th
      loggedAt: "2026-08-05T13:00:00.000Z",
    });
    const ctx: EngineContext = { courses: [course], events: [given], courseEvents: [] };

    // +8h = 21:00 UTC = 22:00 BST, still on the 5th. Nothing logged since.
    const dueAtIso = "2026-08-05T21:00:00.000Z";
    for (const day of ["2026-08-05", "2026-08-06", "2026-08-07", "2026-08-12"]) {
      const occs = getOccurrences(day, ctx);
      expect(occs, `expected an occurrence on ${day}`).toHaveLength(1);
      expect(occs[0].dueAt?.toISOString()).toBe(dueAtIso);
      expect(occs[0].event).toBeNull();
    }
    // And it reads as actionable, not as something already dealt with.
    expect(getDoseState(getOccurrences("2026-08-07", ctx)[0], atLocalTime("2026-08-07", "09:00"))).toBe(
      "overdue",
    );
  });

  it("moves past a SKIPPED dose rather than repeating it — the skipped slot is never re-emitted", () => {
    const course = makeCourse({
      schedule: { kind: "fromLastDose", intervalHours: 8 },
      startDate: "2026-08-01",
    });
    const given = makeEvent({
      courseId: course.id,
      scheduledFor: null,
      status: "given",
      givenAt: "2026-08-05T13:00:00.000Z",
      loggedAt: "2026-08-05T13:00:00.000Z",
    });
    const skippedSlot = "2026-08-05T21:00:00.000Z";
    const skipped = makeEvent({
      courseId: course.id,
      status: "skipped",
      scheduledFor: skippedSlot,
      givenAt: "2026-08-05T21:30:00.000Z",
      loggedAt: "2026-08-05T21:30:00.000Z",
    });
    const ctx: EngineContext = { courses: [course], events: [given, skipped], courseEvents: [] };

    // The chain has advanced one interval past the skipped slot, and what it
    // now offers is outstanding rather than a resolved row shown again.
    for (const day of ["2026-08-05", "2026-08-06", "2026-08-09"]) {
      const occs = getOccurrences(day, ctx);
      expect(occs, `expected an occurrence on ${day}`).toHaveLength(1);
      expect(occs[0].dueAt?.toISOString()).toBe("2026-08-06T05:00:00.000Z");
      expect(occs[0].event).toBeNull();
      expect(occs[0].key).not.toBe(occurrenceKeyFor(course.id, skippedSlot));
    }
  });

  // Reported from a real household, reconstructed exactly: Corneregel every
  // 2h. 23:12 give (next dose 01:12), then a 23:42 skip of that 01:12 slot.
  // The chain used to advance ONLY on a `given` event, so `dueAt` stayed
  // pinned at 01:12 with a skip bound to it — resolved, forever. The course
  // could never offer another dose: the pet read "all done" on both days and
  // there was no Give button anywhere to bring it back.
  it("a SKIPPED dose still advances the chain, so the course can never dead-end", () => {
    const course = makeCourse({
      schedule: { kind: "fromLastDose", intervalHours: 2 },
      startDate: "2026-08-01",
    });
    const given2312 = makeEvent({
      courseId: course.id,
      scheduledFor: null,
      status: "given",
      givenAt: "2026-08-11T20:12:00.000Z", // 21:12 BST on the 11th
      loggedAt: "2026-08-11T20:12:00.000Z",
    });
    // The 01:12 slot that give produced, skipped half an hour later.
    const skippedSlot = "2026-08-11T22:12:00.000Z"; // 23:12 BST — +2h
    const skipped = makeEvent({
      courseId: course.id,
      status: "skipped",
      scheduledFor: skippedSlot,
      givenAt: "2026-08-11T20:42:00.000Z",
      loggedAt: "2026-08-11T20:42:00.000Z",
    });
    const ctx: EngineContext = {
      courses: [course],
      events: [given2312, skipped],
      courseEvents: [],
    };

    // The next day the course must still be offering a dose.
    const occs = getOccurrences("2026-08-12", ctx);
    expect(occs).toHaveLength(1);
    expect(occs[0].event).toBeNull();
    // One interval on from the slot that was skipped — the grid continues.
    expect(occs[0].dueAt?.toISOString()).toBe("2026-08-12T00:12:00.000Z");
    expect(getDoseState(occs[0], atLocalTime("2026-08-12", "09:59"))).toBe("overdue");
  });

  it("stops once that overdue dose is GIVEN — the chain re-anchors onto a new occurrence", () => {
    const course = makeCourse({
      schedule: { kind: "fromLastDose", intervalHours: 8 },
      startDate: "2026-08-01",
    });
    const first = makeEvent({
      courseId: course.id,
      scheduledFor: null,
      status: "given",
      givenAt: "2026-08-05T13:00:00.000Z",
      loggedAt: "2026-08-05T13:00:00.000Z",
    });
    const late = makeEvent({
      courseId: course.id,
      status: "given",
      scheduledFor: "2026-08-05T21:00:00.000Z",
      givenAt: "2026-08-07T08:00:00.000Z", // finally given two days later
      loggedAt: "2026-08-07T08:00:00.000Z",
    });
    const ctx: EngineContext = { courses: [course], events: [first, late], courseEvents: [] };

    const occs = getOccurrences("2026-08-07", ctx);
    expect(occs).toHaveLength(1);
    // Anchored on the late dose, not still showing the old outstanding one.
    expect(occs[0].dueAt?.toISOString()).toBe("2026-08-07T16:00:00.000Z");
    expect(occs[0].event).toBeNull();
  });

  // Generic-arithmetic regression guard, NOT a test of the "Every 2h" UI
  // choice: `intervalHours` is a plain `number` (domain/types.ts) and this
  // file's arithmetic was never touched to add that choice — it already
  // handled 2 before. Kept only to pin the boundary value now that the UI
  // can produce it; the UI wiring itself is covered in scheduleChoice.test.ts.
  it("generic fromLastDose arithmetic: intervalHours: 2 lands the chain 2h after the last given dose", () => {
    const course = makeCourse({
      schedule: { kind: "fromLastDose", intervalHours: 2 },
      startDate: "2026-08-01",
    });
    const given = makeEvent({
      courseId: course.id,
      scheduledFor: null,
      status: "given",
      givenAt: "2026-08-06T10:00:00.000Z",
      loggedAt: "2026-08-06T10:00:00.000Z",
    });
    const ctx: EngineContext = { courses: [course], events: [given], courseEvents: [] };
    // Anchor 2026-08-06T10:00Z + 2h = 2026-08-06T12:00Z, same day.
    const occs = getOccurrences("2026-08-06", ctx);
    expect(occs).toHaveLength(1);
    expect(occs[0].dueAt?.toISOString()).toBe("2026-08-06T12:00:00.000Z");
  });

  it("SPEC §3b: an anchored every-4h course is actionable 1 hour after the last dose, even though the interval has not elapsed and the due instant lands the next local day", () => {
    const course = makeCourse({
      schedule: { kind: "fromLastDose", intervalHours: 4 },
      startDate: "2026-08-01",
    });
    const givenAt = "2026-08-05T21:30:00.000Z"; // 22:30 BST
    const given = makeEvent({
      courseId: course.id,
      scheduledFor: null,
      status: "given",
      givenAt,
      loggedAt: givenAt,
    });
    const ctx: EngineContext = { courses: [course], events: [given], courseEvents: [] };

    const oneHourLater = new Date("2026-08-05T22:30:00.000Z"); // 23:30 BST, still on the anchor's day
    const occs = getOccurrences("2026-08-05", ctx);
    expect(occs).toHaveLength(1);
    const occ = occs[0];
    // Due instant: 22:30Z + 4h = 2026-08-06T01:30:00.000Z — the next local day.
    expect(occ.dueAt?.toISOString()).toBe("2026-08-06T01:30:00.000Z");
    // Not due yet, not overdue — but present, and (per `getDoseState`'s
    // existing `upcoming` branch) distinguishable from a same-day "later"
    // dose so the row can say which day it is actually due.
    expect(getDoseState(occ, oneHourLater)).toBe("upcoming");
  });

  it("SPEC §3b: logging that early dose re-anchors the chain from the actual given time, not the original schedule", () => {
    const course = makeCourse({
      schedule: { kind: "fromLastDose", intervalHours: 4 },
      startDate: "2026-08-01",
    });
    const firstGivenAt = "2026-08-05T21:30:00.000Z"; // 22:30 BST — would plan the next dose at 2026-08-06T01:30Z
    const first = makeEvent({
      courseId: course.id,
      scheduledFor: null,
      status: "given",
      givenAt: firstGivenAt,
      loggedAt: firstGivenAt,
    });
    // Given early — only 1 hour later, not the full 4h interval. `scheduledFor`
    // is the occurrence it was logged against: the planned 2026-08-06T01:30Z slot.
    const earlyGivenAt = "2026-08-05T22:30:00.000Z"; // 23:30 BST
    const early = makeEvent({
      courseId: course.id,
      scheduledFor: "2026-08-06T01:30:00.000Z",
      status: "given",
      givenAt: earlyGivenAt,
      loggedAt: earlyGivenAt,
    });
    const ctx: EngineContext = { courses: [course], events: [first, early], courseEvents: [] };

    expect(anchorFor(course, ctx.events)!.toISOString()).toBe(earlyGivenAt);

    // The chain's next dose comes off the ACTUAL given time (23:30 BST),
    // not the original 22:30-BST-derived grid — 23:30Z + 4h = 2026-08-06T02:30Z.
    const onNewDueDay = getOccurrences("2026-08-06", ctx);
    expect(onNewDueDay).toHaveLength(1);
    expect(onNewDueDay[0].dueAt?.toISOString()).toBe("2026-08-06T02:30:00.000Z");

    // And the SAME re-anchored occurrence is already visible on the new
    // anchor's OWN day (2026-08-05 — the early give itself happened there),
    // not only once its due day arrives: this is what keeps the chain
    // giveable early again after an early give, not just reachable once.
    const onAnchorDay = getOccurrences("2026-08-05", ctx);
    expect(onAnchorDay).toHaveLength(1);
    expect(onAnchorDay[0].dueAt?.toISOString()).toBe("2026-08-06T02:30:00.000Z");
    expect(onAnchorDay[0].key).toBe(onNewDueDay[0].key);
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

describe("getOccurrences — fromLastDose maxPerDay (SPEC §3b-i)", () => {
  // CRITICAL SCOPE GUARD (SPEC §3b-i's builder checklist / §12): with no
  // `maxPerDay` set, the occurrence must carry neither field at all — not
  // merely `givenToday < maxPerDay` — regardless of how many doses were
  // actually given that day. This is what keeps `getDoseState` from ever
  // computing `capped` for an uncapped course.
  it("CRITICAL SCOPE GUARD: with no maxPerDay set, maxPerDay/givenToday are both absent no matter how many doses were given today", () => {
    const course = makeCourse({
      schedule: { kind: "fromLastDose", intervalHours: 4 },
      startDate: "2026-08-01",
    });
    const events = [
      makeEvent({
        courseId: course.id,
        scheduledFor: null,
        givenAt: "2026-08-06T05:00:00.000Z",
        loggedAt: "2026-08-06T05:00:00.000Z",
      }),
      makeEvent({
        courseId: course.id,
        scheduledFor: "2026-08-06T09:00:00.000Z",
        givenAt: "2026-08-06T09:00:00.000Z",
        loggedAt: "2026-08-06T09:00:00.000Z",
      }),
      makeEvent({
        courseId: course.id,
        scheduledFor: "2026-08-06T13:00:00.000Z",
        givenAt: "2026-08-06T13:00:00.000Z",
        loggedAt: "2026-08-06T13:00:00.000Z",
      }),
    ];
    const ctx: EngineContext = { courses: [course], events, courseEvents: [] };
    const occs = getOccurrences("2026-08-06", ctx);
    expect(occs).toHaveLength(1);
    expect(occs[0].maxPerDay).toBeUndefined();
    expect(occs[0].givenToday).toBeUndefined();
    expect(occs[0].dueAt?.toISOString()).toBe("2026-08-06T17:00:00.000Z"); // plain +4h, no cap logic touches it
  });

  it("under the cap: dueAt is plain anchor + intervalHours, unaffected, and maxPerDay/givenToday are both carried", () => {
    const course = makeCourse({
      schedule: { kind: "fromLastDose", intervalHours: 4, maxPerDay: 3 },
      startDate: "2026-08-01",
    });
    const given = makeEvent({
      courseId: course.id,
      scheduledFor: null,
      givenAt: "2026-08-06T05:00:00.000Z", // 06:00 BST
      loggedAt: "2026-08-06T05:00:00.000Z",
    });
    const ctx: EngineContext = { courses: [course], events: [given], courseEvents: [] };
    const occs = getOccurrences("2026-08-06", ctx);
    expect(occs).toHaveLength(1);
    expect(occs[0].dueAt?.toISOString()).toBe("2026-08-06T09:00:00.000Z"); // +4h, untouched
    expect(occs[0].maxPerDay).toBe(3);
    expect(occs[0].givenToday).toBe(1);
  });

  it("reaching the cap same-day pushes the effective due instant to 00:00 the next day, when that is later than the plain interval math", () => {
    const course = makeCourse({
      schedule: { kind: "fromLastDose", intervalHours: 4, maxPerDay: 3 },
      startDate: "2026-08-01",
    });
    // 08:00, 12:00, 16:00 BST — three given doses today (2026-08-06).
    const events = [
      makeEvent({
        courseId: course.id,
        scheduledFor: null,
        givenAt: "2026-08-06T07:00:00.000Z",
        loggedAt: "2026-08-06T07:00:00.000Z",
      }),
      makeEvent({
        courseId: course.id,
        scheduledFor: "2026-08-06T11:00:00.000Z",
        givenAt: "2026-08-06T11:00:00.000Z",
        loggedAt: "2026-08-06T11:00:00.000Z",
      }),
      makeEvent({
        courseId: course.id,
        scheduledFor: "2026-08-06T15:00:00.000Z",
        givenAt: "2026-08-06T15:00:00.000Z",
        loggedAt: "2026-08-06T15:00:00.000Z",
      }),
    ];
    const ctx: EngineContext = { courses: [course], events, courseEvents: [] };

    // Plain math: last given 16:00 BST + 4h = 20:00 BST, same day — but the
    // cap has been reached, so the effective due instant is pushed to 00:00
    // BST the next day instead (later than 20:00).
    const today = getOccurrences("2026-08-06", ctx);
    expect(today).toHaveLength(1);
    expect(today[0].dueAt?.toISOString()).toBe("2026-08-06T23:00:00.000Z"); // 00:00 BST on 08-07
    expect(today[0].maxPerDay).toBe(3);
    expect(today[0].givenToday).toBe(3); // today's own count: at the cap

    // The SAME occurrence (same key, same dueAt) also appears on the day it
    // is now due — with a FRESH count for that day, so it reads plain
    // due/later/overdue there once its instant arrives, not capped.
    const tomorrow = getOccurrences("2026-08-07", ctx);
    expect(tomorrow).toHaveLength(1);
    expect(tomorrow[0].key).toBe(today[0].key);
    expect(tomorrow[0].dueAt?.toISOString()).toBe(today[0].dueAt?.toISOString());
    expect(tomorrow[0].givenToday).toBe(0);
  });

  it("when the plain interval math already crosses into the next day past the push floor, dueAt is left exactly as plain arithmetic computes it", () => {
    const course = makeCourse({
      schedule: { kind: "fromLastDose", intervalHours: 8, maxPerDay: 3 },
      startDate: "2026-08-01",
    });
    // 06:00, 14:00, 22:00 BST — three given doses today (2026-08-06), the
    // exact SPEC §12 "every 8h, max 3 per day" example.
    const events = [
      makeEvent({
        courseId: course.id,
        scheduledFor: null,
        givenAt: "2026-08-06T05:00:00.000Z",
        loggedAt: "2026-08-06T05:00:00.000Z",
      }),
      makeEvent({
        courseId: course.id,
        scheduledFor: "2026-08-06T13:00:00.000Z",
        givenAt: "2026-08-06T13:00:00.000Z",
        loggedAt: "2026-08-06T13:00:00.000Z",
      }),
      makeEvent({
        courseId: course.id,
        scheduledFor: "2026-08-06T21:00:00.000Z",
        givenAt: "2026-08-06T21:00:00.000Z",
        loggedAt: "2026-08-06T21:00:00.000Z",
      }),
    ];
    const ctx: EngineContext = { courses: [course], events, courseEvents: [] };
    const occs = getOccurrences("2026-08-06", ctx);
    expect(occs).toHaveLength(1);
    // 22:00 BST + 8h = 06:00 BST the next day — already later than 00:00, so
    // the cap changes nothing about the due instant here.
    expect(occs[0].dueAt?.toISOString()).toBe("2026-08-07T05:00:00.000Z");
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

  // The reported bug: "sometimes when I update a course, the change is not
  // reflected on Today". Forward-only used to freeze EVERY past slot, logged
  // or not, so a lunchtime edit to this morning's time was invisible until
  // tomorrow — while the dose amount changed in the same save updated at
  // once, because occurrences read `doseAmount` live. Pinning is now what
  // §3c actually needs it to be: protection for slots that carry history.
  it("edit at 14:00 moving an UNLOGGED 08:00 slot to 09:00: the new time shows today", () => {
    const day = "2026-08-10";
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["09:00", "18:00"] },
      startDate: "2026-08-01",
    });
    const edited = makeEditedEvent({
      courseId: course.id,
      at: atLocalTime(day, "14:00").toISOString(),
      before: ["08:00", "20:00"],
      after: ["09:00", "18:00"],
    });
    const ctx: EngineContext = { courses: [course], events: [], courseEvents: [edited] };

    const occs = getOccurrences(day, ctx);
    expect(occs.map((o) => o.dueAt?.toISOString())).toEqual(
      ["09:00", "18:00"].map((t) => atLocalTime(day, t).toISOString()),
    );
  });

  it("the same edit with 08:00 already given: that slot stays pinned at 08:00 and keeps its event", () => {
    const day = "2026-08-10";
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["09:00", "18:00"] },
      startDate: "2026-08-01",
    });
    const edited = makeEditedEvent({
      courseId: course.id,
      at: atLocalTime(day, "14:00").toISOString(),
      before: ["08:00", "20:00"],
      after: ["09:00", "18:00"],
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
    expect(occs.map((o) => o.dueAt?.toISOString())).toEqual(
      ["08:00", "18:00"].map((t) => atLocalTime(day, t).toISOString()),
    );
    expect(occs[0].event?.id).toBe(given0800.id);
  });

  // A skip is history too — the pin test asks whether the slot carries a live
  // DoseEvent, not whether the dose was actually swallowed.
  it("a SKIPPED past slot is pinned exactly as a given one is", () => {
    const day = "2026-08-10";
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["09:00"] },
      startDate: "2026-08-01",
    });
    const edited = makeEditedEvent({
      courseId: course.id,
      at: atLocalTime(day, "14:00").toISOString(),
      before: ["08:00"],
      after: ["09:00"],
    });
    const skipped0800 = makeEvent({
      courseId: course.id,
      status: "skipped",
      scheduledFor: atLocalTime(day, "08:00").toISOString(),
    });
    const ctx: EngineContext = {
      courses: [course],
      events: [skipped0800],
      courseEvents: [edited],
    };

    const occs = getOccurrences(day, ctx);
    expect(occs).toHaveLength(1);
    expect(occs[0].dueAt?.toISOString()).toBe(atLocalTime(day, "08:00").toISOString());
    expect(occs[0].event?.id).toBe(skipped0800.id);
  });

  it("a RETRACTED dose stops pinning its slot — the edit lands once the history is gone", () => {
    const day = "2026-08-10";
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["09:00"] },
      startDate: "2026-08-01",
    });
    const edited = makeEditedEvent({
      courseId: course.id,
      at: atLocalTime(day, "14:00").toISOString(),
      before: ["08:00"],
      after: ["09:00"],
    });
    const deleted0800 = makeEvent({
      courseId: course.id,
      scheduledFor: atLocalTime(day, "08:00").toISOString(),
      deletedAt: atLocalTime(day, "13:00").toISOString(),
    });
    const ctx: EngineContext = {
      courses: [course],
      events: [deleted0800],
      courseEvents: [edited],
    };

    const occs = getOccurrences(day, ctx);
    expect(occs).toHaveLength(1);
    expect(occs[0].dueAt?.toISOString()).toBe(atLocalTime(day, "09:00").toISOString());
  });

  it("a removed slot that already carries a dose is not deleted out from under it", () => {
    const day = "2026-08-10";
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["08:00"] },
      startDate: "2026-08-01",
    });
    const edited = makeEditedEvent({
      courseId: course.id,
      at: atLocalTime(day, "16:00").toISOString(),
      before: ["08:00", "14:00"],
      after: ["08:00"],
    });
    const given1400 = makeEvent({
      courseId: course.id,
      scheduledFor: atLocalTime(day, "14:00").toISOString(),
    });
    const ctx: EngineContext = {
      courses: [course],
      events: [given1400],
      courseEvents: [edited],
    };

    // Index pairing consumes the surviving "08:00" against slot 0, so the
    // dropped "14:00" is the SURPLUS old slot — the branch that has to
    // consult the pin test too, not just the paired one.
    const occs = getOccurrences(day, ctx);
    expect(occs.map((o) => o.dueAt?.toISOString())).toEqual(
      ["08:00", "14:00"].map((t) => atLocalTime(day, t).toISOString()),
    );
    expect(occs[1].event?.id).toBe(given1400.id);
  });

  it("an edit that makes today ineligible still shows a dose already logged today", () => {
    const day = "2026-08-10"; // Monday, ISO weekday 1
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["08:00"], daysOfWeek: [6] }, // Saturday only
      startDate: "2026-08-01",
    });
    const edited = makeScheduleEvent({
      courseId: course.id,
      at: atLocalTime(day, "14:00").toISOString(),
      kind: "edited",
      before: { kind: "fixedTimes", times: ["08:00"] },
      after: { kind: "fixedTimes", times: ["08:00"], daysOfWeek: [6] },
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
    expect(occs).toHaveLength(1);
    expect(occs[0].event?.id).toBe(given0800.id);
  });

  it("never emits the same slot twice when a pinned time collides with a moved one", () => {
    const day = "2026-08-10";
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["07:00", "08:00"] },
      startDate: "2026-08-01",
    });
    const edited = makeEditedEvent({
      courseId: course.id,
      at: atLocalTime(day, "14:00").toISOString(),
      before: ["08:00", "20:00"],
      after: ["07:00", "08:00"],
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

    // Slot 0 pins to 08:00 (given); slot 1 moves to 08:00 as well. One row.
    const occs = getOccurrences(day, ctx);
    expect(occs).toHaveLength(1);
    expect(occs[0].dueAt?.toISOString()).toBe(atLocalTime(day, "08:00").toISOString());
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

  // Slot 0's NEW time (08:30) is still earlier than the 09:00 edit, which is
  // what keeps this a per-slot-eligibility case: the slot follows the edit
  // (nothing is logged against it, so nothing pins it), and is then judged
  // against the version governing 08:30 — the OLD one.
  it("daysOfWeek: ineligible under OLD, eligible under NEW — only the post-edit slot appears", () => {
    const day = "2026-08-10"; // Monday, ISO weekday 1
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["08:30", "21:00"], daysOfWeek: [1] },
      startDate: "2026-08-01",
    });
    const edited = makeScheduleEvent({
      courseId: course.id,
      at: atLocalTime(day, "09:00").toISOString(),
      kind: "edited",
      before: { kind: "fixedTimes", times: ["08:00", "20:00"], daysOfWeek: [2] }, // Tuesday only: ineligible
      after: { kind: "fixedTimes", times: ["08:30", "21:00"], daysOfWeek: [1] }, // Monday: eligible
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

  // Same construction as the daysOfWeek twin above: slot 0 moves to 08:30,
  // still ahead of the 09:00 edit, so the OLD version judges it.
  it("everyNDays: ineligible under OLD, eligible under NEW — only the post-edit slot appears", () => {
    const day = "2026-08-04"; // offset 3 from startDate
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["08:30", "21:00"], everyNDays: 3 },
      startDate: "2026-08-01",
    });
    const edited = makeScheduleEvent({
      courseId: course.id,
      at: atLocalTime(day, "09:00").toISOString(),
      kind: "edited",
      before: { kind: "fixedTimes", times: ["08:00", "20:00"], everyNDays: 2 }, // offset 3 % 2 !== 0: ineligible
      after: { kind: "fixedTimes", times: ["08:30", "21:00"], everyNDays: 3 }, // offset 3 % 3 === 0: eligible
    });
    const ctx: EngineContext = { courses: [course], events: [], courseEvents: [edited] };

    const occs = getOccurrences(day, ctx);
    expect(occs).toHaveLength(1);
    expect(occs[0].dueAt?.toISOString()).toBe(atLocalTime(day, "21:00").toISOString());
  });
});
