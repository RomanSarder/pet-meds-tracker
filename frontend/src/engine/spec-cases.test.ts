// SPEC.md §12's test cases worth writing first, named after the spec bullet
// each covers (titles quote or closely paraphrase the bullet text, not its
// index — the bullet list has already been renumbered once by an earlier
// insertion, and index-based names are exactly what breaks when that
// happens again).
// Bullet 4 ("the corrected-time picker cannot produce a givenAt in the
// future or before 00:00 today") is a picker property, not an engine one —
// see frontend/src/features/today/logAtTimeModel.test.ts.
// Bullets 7-10 are outside the engine's surface (undo, stock, supply cover)
// and are not this file's job.
import { describe, expect, it } from "vitest";
import type { Course, DoseEvent } from "@/domain";
import { FIXTURE_NOW, atLocalTime, fixtures, localDayKey, occurrenceKeyFor } from "@/domain";
import type { EngineContext } from "./engine.types";
import { getDoseState, getOccurrences, nextDueAt } from "./index";

function fixedTimesCourse(
  id: string,
  times: string[],
  opts: { startDate: string; endDate?: string | null; status?: Course["status"] },
): Course {
  return {
    id,
    petId: "pet-1",
    medicationId: "med-1",
    doseAmount: 1,
    doseUnit: "ml",
    instructions: null,
    schedule: { kind: "fixedTimes", times },
    startDate: opts.startDate,
    endDate: opts.endDate ?? null,
    status: opts.status ?? "active",
    notes: null,
    resumedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
  };
}

function fromLastDoseCourse(
  id: string,
  intervalHours: number,
  opts: { startDate: string; anchorTime?: string },
): Course {
  return {
    id,
    petId: "pet-1",
    medicationId: "med-1",
    doseAmount: 1,
    doseUnit: "ml",
    instructions: null,
    schedule: {
      kind: "fromLastDose",
      intervalHours,
      ...(opts.anchorTime ? { anchorTime: opts.anchorTime } : {}),
    },
    startDate: opts.startDate,
    endDate: null,
    status: "active",
    notes: null,
    resumedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
  };
}

function givenEvent(
  id: string,
  courseId: string,
  opts: { scheduledFor: string | null; givenAt: string },
): DoseEvent {
  return {
    id,
    courseId,
    scheduledFor: opts.scheduledFor,
    status: "given",
    loggedAt: opts.givenAt,
    givenAt: opts.givenAt,
    amount: 1,
    note: null,
    occurrenceKey: occurrenceKeyFor(courseId, opts.scheduledFor),
    supersedesId: null,
    actorId: "test-actor-id",
    createdAt: opts.givenAt,
    updatedAt: opts.givenAt,
    deletedAt: null,
  };
}

describe("SPEC §12 — a fromLastDose course logged 90 minutes late moves the next due time by 90 minutes", () => {
  it("shifts nextDueAt by exactly 90 minutes when the anchoring dose was given 90 minutes later", () => {
    const onTimeCourse = fromLastDoseCourse("case1-on-time", 8, { startDate: "2026-08-01" });
    const lateCourse = fromLastDoseCourse("case1-late", 8, { startDate: "2026-08-01" });

    const onTimeGivenAt = "2026-08-08T08:00:00.000Z";
    const lateGivenAt = "2026-08-08T09:30:00.000Z"; // 90 minutes later

    const onTimeEvent = givenEvent("case1-ev-on-time", onTimeCourse.id, {
      scheduledFor: null,
      givenAt: onTimeGivenAt,
    });
    const lateEvent = givenEvent("case1-ev-late", lateCourse.id, {
      scheduledFor: null,
      givenAt: lateGivenAt,
    });

    const after = new Date(2026, 6, 1, 0, 0); // well before both anchors

    const nextOnTime = nextDueAt(onTimeCourse, [onTimeEvent], [], after);
    const nextLate = nextDueAt(lateCourse, [lateEvent], [], after);

    expect(nextOnTime).not.toBeNull();
    expect(nextLate).not.toBeNull();
    expect(nextLate!.getTime() - nextOnTime!.getTime()).toBe(90 * 60_000);
  });
});

describe('SPEC §12 — "at its scheduled time" writes givenAt equal to the occurrence\'s due time, so a fromLastDose chain stays on its planned grid', () => {
  it("mirrors case 1 with zero delta: given exactly at the due instant, nextDueAt lands exactly on the next planned grid tick", () => {
    const day = "2026-08-08";
    const course = fromLastDoseCourse("case-on-time-course", 8, {
      startDate: "2026-08-01",
      anchorTime: "08:00",
    });

    // The planned grid instant, computed independently of the event: 08:00
    // local on `day`, the same clock time the chain would land on if it had
    // never drifted.
    const plannedDueAt = atLocalTime(day, "08:00");

    const event = givenEvent("case-on-time-ev", course.id, {
      scheduledFor: null,
      givenAt: plannedDueAt.toISOString(), // "at its scheduled time"
    });

    const after = new Date(2026, 6, 1, 0, 0); // well before the anchor
    const next = nextDueAt(course, [event], [], after);

    expect(next).not.toBeNull();
    // Exactly the next grid tick — not "close to" it. Zero drift, unlike
    // case 1's 90-minute shift.
    expect(next!.getTime()).toBe(plannedDueAt.getTime() + 8 * 3_600_000);
    // The event reads as on time: givenAt is exactly the due instant, no delta.
    expect(event.givenAt).toBe(plannedDueAt.toISOString());
  });
});

// SPEC §12 — "the corrected-time picker cannot produce a givenAt in the
// future or before 00:00 today" is a picker property, not an engine one;
// see frontend/src/features/today/logAtTimeModel.test.ts.

describe("SPEC §12 — a fixedTimes course logged late does not move the following dose", () => {
  it("the 20:00 occurrence is identical whether the 08:00 dose was logged at 08:00 or at 11:30", () => {
    const day = "2026-08-08";
    const course = fixedTimesCourse("case2-course", ["08:00", "20:00"], { startDate: "2026-08-01" });

    const dueAt0800 = atLocalTime(day, "08:00");
    const scheduledFor0800 = dueAt0800.toISOString();

    const onTimeEvent = givenEvent("case2-ev-on-time", course.id, {
      scheduledFor: scheduledFor0800,
      givenAt: dueAt0800.toISOString(),
    });
    const lateEvent = givenEvent("case2-ev-late", course.id, {
      scheduledFor: scheduledFor0800,
      givenAt: atLocalTime(day, "11:30").toISOString(),
    });

    const occsOnTime = getOccurrences(day, { courses: [course], events: [onTimeEvent], courseEvents: [] });
    const occsLate = getOccurrences(day, { courses: [course], events: [lateEvent], courseEvents: [] });

    const twentyDueAt = atLocalTime(day, "20:00");
    const twentyOnTime = occsOnTime.find((o) => o.dueAt?.getTime() === twentyDueAt.getTime())!;
    const twentyLate = occsLate.find((o) => o.dueAt?.getTime() === twentyDueAt.getTime())!;

    expect(twentyOnTime).toBeDefined();
    expect(twentyLate).toBeDefined();
    expect(twentyOnTime.dueAt!.getTime()).toBe(twentyLate.dueAt!.getTime());
    expect(twentyOnTime.key).toBe(twentyLate.key);
    // The 08:00 log (on time or late) has no bearing on the 20:00 slot.
    expect(twentyOnTime.event).toBeNull();
    expect(twentyLate.event).toBeNull();
  });
});

describe("SPEC §12 — a dose scheduled 23:00 and logged 00:20 counts against the previous day", () => {
  it("the given event resolves the earlier day's 23:00 occurrence (by scheduledFor), and the later day's occurrence stays un-given", () => {
    const day = "2026-08-08";
    const nextDay = "2026-08-09";
    const course = fixedTimesCourse("case3-course", ["23:00"], { startDate: "2026-08-01" });

    const dueAt2300 = atLocalTime(day, "23:00");
    const scheduledFor = dueAt2300.toISOString();
    // Logged the following morning — givenAt is on nextDay, but scheduledFor
    // (and therefore the join) is on day.
    const givenAtNextMorning = atLocalTime(nextDay, "00:20").toISOString();

    const event = givenEvent("case3-ev", course.id, {
      scheduledFor,
      givenAt: givenAtNextMorning,
    });

    const ctx: EngineContext = { courses: [course], events: [event], courseEvents: [] };

    const occToday = getOccurrences(day, ctx)[0];
    const occTomorrow = getOccurrences(nextDay, ctx)[0];

    expect(occToday.day).toBe(day);
    expect(occToday.event?.id).toBe(event.id);
    expect(occToday.event?.status).toBe("given");

    expect(occTomorrow.day).toBe(nextDay);
    expect(occTomorrow.key).not.toBe(occToday.key);
    expect(occTomorrow.event).toBeNull();
  });
});

describe("SPEC §12 — pausing a course removes it from Today but leaves its history intact (engine half)", () => {
  it("generates no occurrences for a paused course while ctx.events is unchanged", () => {
    const course = fixedTimesCourse("case4-course", ["08:00"], {
      startDate: "2026-08-01",
      status: "paused",
    });
    const event = givenEvent("case4-ev", course.id, {
      scheduledFor: atLocalTime("2026-08-07", "08:00").toISOString(),
      givenAt: atLocalTime("2026-08-07", "08:05").toISOString(),
    });
    const ctx: EngineContext = { courses: [course], events: [event], courseEvents: [] };

    const occs = getOccurrences("2026-08-08", ctx);

    expect(occs).toHaveLength(0);
    expect(ctx.events).toHaveLength(1);
    expect(ctx.events[0]).toBe(event);
  });
});

describe("SPEC §12 — nothing is due for an interval course that has never been started", () => {
  it("reports dueAt === null and getDoseState notStarted for the fixture corpus's never-started fromLastDose course", () => {
    const day = localDayKey(new Date(FIXTURE_NOW));
    const ctx: EngineContext = { courses: fixtures.courses, events: fixtures.doseEvents, courseEvents: [] };
    const course = fixtures.courses.find(
      (c) => c.schedule.kind === "fromLastDose" && !fixtures.doseEvents.some((e) => e.courseId === c.id),
    )!;
    expect(course).toBeDefined();

    const occs = getOccurrences(day, ctx);
    const occ = occs.find((o) => o.courseId === course.id)!;

    expect(occ.dueAt).toBeNull();
    expect(occ.key).toBe(occurrenceKeyFor(course.id, null));
    expect(getDoseState(occ, new Date(FIXTURE_NOW))).toBe("notStarted");
  });

  it("still reports notStarted for a never-started fromLastDose course seeded with anchorTime, even though it has a display dueAt", () => {
    const day = "2026-08-08";
    const course = fromLastDoseCourse("case9-anchor-time", 12, {
      startDate: "2026-08-01",
      anchorTime: "09:00",
    });
    const ctx: EngineContext = { courses: [course], events: [], courseEvents: [] };

    const occ = getOccurrences(day, ctx)[0];

    expect(occ.dueAt).not.toBeNull();
    expect(occ.key).toBe(occurrenceKeyFor(course.id, null));
    expect(getDoseState(occ, atLocalTime(day, "12:00"))).toBe("notStarted");
  });
});
