// SPEC.md §11's test cases worth writing first, each named after the case it
// covers. Case numbering follows the bullet order in SPEC §11 (1-indexed).
// Cases 5-8 are outside the engine's surface (undo, stock, supply cover) and
// are not this file's job.
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
    createdAt: opts.givenAt,
    updatedAt: opts.givenAt,
    deletedAt: null,
  };
}

describe("SPEC §11 case 1 — a fromLastDose course logged 90 minutes late moves the next due time by 90 minutes", () => {
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

    const nextOnTime = nextDueAt(onTimeCourse, [onTimeEvent], after);
    const nextLate = nextDueAt(lateCourse, [lateEvent], after);

    expect(nextOnTime).not.toBeNull();
    expect(nextLate).not.toBeNull();
    expect(nextLate!.getTime() - nextOnTime!.getTime()).toBe(90 * 60_000);
  });
});

describe("SPEC §11 case 2 — a fixedTimes course logged late does not move the following dose", () => {
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

    const occsOnTime = getOccurrences(day, { courses: [course], events: [onTimeEvent] });
    const occsLate = getOccurrences(day, { courses: [course], events: [lateEvent] });

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

describe("SPEC §11 case 3 — a dose scheduled 23:00 and logged 00:20 the next morning counts against the previous day", () => {
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

    const ctx: EngineContext = { courses: [course], events: [event] };

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

describe("SPEC §11 case 4 (engine half) — pausing a course removes it from Today, leaving its events untouched", () => {
  it("generates no occurrences for a paused course while ctx.events is unchanged", () => {
    const course = fixedTimesCourse("case4-course", ["08:00"], {
      startDate: "2026-08-01",
      status: "paused",
    });
    const event = givenEvent("case4-ev", course.id, {
      scheduledFor: atLocalTime("2026-08-07", "08:00").toISOString(),
      givenAt: atLocalTime("2026-08-07", "08:05").toISOString(),
    });
    const ctx: EngineContext = { courses: [course], events: [event] };

    const occs = getOccurrences("2026-08-08", ctx);

    expect(occs).toHaveLength(0);
    expect(ctx.events).toHaveLength(1);
    expect(ctx.events[0]).toBe(event);
  });
});

describe("SPEC §11 case 9 — nothing is due for an interval course that has never been started", () => {
  it("reports dueAt === null and getDoseState notStarted for the fixture corpus's never-started fromLastDose course", () => {
    const day = localDayKey(new Date(FIXTURE_NOW));
    const ctx: EngineContext = { courses: fixtures.courses, events: fixtures.doseEvents };
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
    const ctx: EngineContext = { courses: [course], events: [] };

    const occ = getOccurrences(day, ctx)[0];

    expect(occ.dueAt).not.toBeNull();
    expect(occ.key).toBe(occurrenceKeyFor(course.id, null));
    expect(getDoseState(occ, atLocalTime(day, "12:00"))).toBe("notStarted");
  });
});
