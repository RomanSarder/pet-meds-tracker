// The load-bearing claim of this feature, stated as tests: editing a past
// dose's time moves nothing else UNLESS the dose is the last one on a
// `fromLastDose` course.
//
// Instants are written as local wall-clock times via `atLocalTime`, never as
// UTC literals: `boundsForEdit`'s course-start floor is local midnight, so a
// test written in UTC would pass or fail depending on the machine's zone.
import { describe, expect, it } from "vitest";
import type { Course, DoseEvent } from "@/domain";
import { atLocalTime } from "@/domain";
import { nextDueAt } from "@/engine";
import {
  atDelta,
  boundsForEdit,
  canStepEarlier,
  canStepLater,
  clampToBounds,
  consequenceFor,
  hasChange,
  liveGivenEvents,
  stepBy,
  STEP_MIN,
} from "./editTimeModel";

const DAY = "2026-08-08";
const NEXT_DAY = "2026-08-09";
const TS = "2026-08-01T00:00:00.000Z";

function at(day: string, time: string): Date {
  return atLocalTime(day, time);
}

function makeCourse(overrides: Partial<Course> = {}): Course {
  return {
    id: "course-1",
    petId: "pet-1",
    medicationId: "med-1",
    doseAmount: 0.4,
    doseUnit: "ml",
    instructions: null,
    schedule: { kind: "fixedTimes", times: ["08:00", "20:00"] },
    startDate: DAY,
    endDate: null,
    status: "active",
    notes: null,
    resumedAt: null,
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
    ...overrides,
  };
}

const intervalCourse = (hours = 8): Course =>
  makeCourse({ schedule: { kind: "fromLastDose", intervalHours: hours } });

function makeDose(id: string, givenAt: Date, overrides: Partial<DoseEvent> = {}): DoseEvent {
  const iso = givenAt.toISOString();
  return {
    id,
    courseId: "course-1",
    scheduledFor: null,
    status: "given",
    loggedAt: iso,
    givenAt: iso,
    amount: 0.4,
    note: null,
    occurrenceKey: "course-1|-",
    supersedesId: null,
    actorId: "user-1",
    createdAt: iso,
    updatedAt: iso,
    deletedAt: null,
    ...overrides,
  };
}

describe("liveGivenEvents", () => {
  it("drops soft-deleted, superseded, skipped and other courses' rows", () => {
    const kept = makeDose("keep", at(DAY, "08:00"));
    const events = [
      kept,
      makeDose("deleted", at(DAY, "09:00"), { deletedAt: TS }),
      makeDose("skipped", at(DAY, "10:00"), { status: "skipped" }),
      makeDose("missed", at(DAY, "11:00"), { status: "missed" }),
      makeDose("original", at(DAY, "12:00")),
      makeDose("correction", at(DAY, "13:00"), { supersedesId: "original" }),
      makeDose("other-course", at(DAY, "14:00"), { courseId: "course-2" }),
    ];
    expect(liveGivenEvents("course-1", events).map((e) => e.id)).toEqual(["keep", "correction"]);
  });

  it("orders by givenAt, then by id so the ordering is total", () => {
    const events = [
      makeDose("b", at(DAY, "08:00")),
      makeDose("a", at(DAY, "08:00")),
      makeDose("c", at(DAY, "07:00")),
    ];
    expect(liveGivenEvents("course-1", events).map((e) => e.id)).toEqual(["c", "a", "b"]);
  });
});

describe("boundsForEdit", () => {
  const now = at(DAY, "18:00");

  it("pens a middle dose between the doses either side of it", () => {
    const first = makeDose("d1", at(DAY, "06:00"));
    const middle = makeDose("d2", at(DAY, "12:00"));
    const last = makeDose("d3", at(DAY, "16:00"));
    const bounds = boundsForEdit(middle, [first, middle, last], makeCourse(), now);

    // A clear minute either side, so the two can never share a displayed
    // minute — but the neighbour times themselves are reported unrounded, for
    // the helper line to quote.
    expect(bounds.floor).toEqual(new Date(at(DAY, "06:00").getTime() + 60_000));
    expect(bounds.ceiling).toEqual(new Date(at(DAY, "16:00").getTime() - 60_000));
    expect(bounds.previousAt).toEqual(at(DAY, "06:00"));
    expect(bounds.nextAt).toEqual(at(DAY, "16:00"));
  });

  it("gives the last dose a ceiling of now, and marks it as having no next", () => {
    const first = makeDose("d1", at(DAY, "06:00"));
    const last = makeDose("d2", at(DAY, "16:00"));
    const bounds = boundsForEdit(last, [first, last], makeCourse(), now);

    expect(bounds.ceiling).toEqual(now);
    expect(bounds.nextAt).toBeNull();
    expect(bounds.previousAt).toEqual(at(DAY, "06:00"));
  });

  it("floors the first dose at local midnight of the course's start date", () => {
    const first = makeDose("d1", at(DAY, "06:00"));
    const last = makeDose("d2", at(DAY, "16:00"));
    const bounds = boundsForEdit(first, [first, last], makeCourse(), now);

    expect(bounds.floor).toEqual(at(DAY, "00:00"));
    expect(bounds.previousAt).toBeNull();
  });

  it("widens to include a dose whose stored time already sits outside the window", () => {
    // Logged the day before its own course started — an imported backup, or a
    // neighbour that was itself corrected. Opening the sheet must not relocate it.
    const stray = makeDose("d1", at("2026-08-07", "22:00"));
    const later = makeDose("d2", at(DAY, "16:00"));
    const bounds = boundsForEdit(stray, [stray, later], makeCourse(), now);

    expect(bounds.floor).toEqual(at("2026-08-07", "22:00"));
    expect(clampToBounds(new Date(stray.givenAt), bounds)).toEqual(at("2026-08-07", "22:00"));
  });

  it("ignores skipped and missed neighbours — neither anchors a chain", () => {
    const skipped = makeDose("s", at(DAY, "10:00"), { status: "skipped" });
    const given = makeDose("g", at(DAY, "12:00"));
    const bounds = boundsForEdit(given, [skipped, given], intervalCourse(), now);

    expect(bounds.previousAt).toBeNull();
    expect(bounds.floor).toEqual(at(DAY, "00:00"));
  });
});

describe("the stepper and the offset chips", () => {
  const now = at(DAY, "18:00");
  const first = makeDose("d1", at(DAY, "06:00"));
  const middle = makeDose("d2", at(DAY, "12:00"));
  const last = makeDose("d3", at(DAY, "16:00"));
  const events = [first, middle, last];
  const bounds = boundsForEdit(middle, events, makeCourse(), now);

  it("offsets from the dose's own time, not from now", () => {
    expect(atDelta(middle, -30, bounds)).toEqual(at(DAY, "11:30"));
    expect(atDelta(middle, 0, bounds)).toEqual(at(DAY, "12:00"));
    expect(atDelta(middle, 60, bounds)).toEqual(at(DAY, "13:00"));
  });

  it("clamps an offset that would cross a neighbour", () => {
    const tight = boundsForEdit(middle, [first, middle, makeDose("d3", at(DAY, "12:20"))], makeCourse(), now);
    expect(atDelta(middle, 60, tight)).toEqual(new Date(at(DAY, "12:20").getTime() - 60_000));
  });

  it("steps in five-minute moves and stops at each end", () => {
    expect(stepBy(at(DAY, "12:00"), -STEP_MIN, bounds)).toEqual(at(DAY, "11:55"));
    expect(stepBy(bounds.floor, -STEP_MIN, bounds)).toEqual(bounds.floor);
    expect(stepBy(bounds.ceiling, STEP_MIN, bounds)).toEqual(bounds.ceiling);
    expect(canStepEarlier(bounds.floor, bounds)).toBe(false);
    expect(canStepLater(bounds.ceiling, bounds)).toBe(false);
    expect(canStepEarlier(at(DAY, "12:00"), bounds)).toBe(true);
    expect(canStepLater(at(DAY, "12:00"), bounds)).toBe(true);
  });

  it("does not count a sub-minute difference as a change", () => {
    expect(hasChange(at(DAY, "12:00"), middle)).toBe(false);
    expect(hasChange(new Date(at(DAY, "12:00").getTime() + 30_000), middle)).toBe(false);
    expect(hasChange(at(DAY, "12:01"), middle)).toBe(true);
  });
});

describe("consequenceFor", () => {
  const now = at(DAY, "18:00");

  it("moves nothing when a fixedTimes dose is edited", () => {
    const dose = makeDose("d1", at(DAY, "08:20"), { scheduledFor: at(DAY, "08:00").toISOString() });
    expect(
      consequenceFor({ course: makeCourse(), events: [dose], event: dose, chosen: at(DAY, "09:30") }),
    ).toEqual({ kind: "unchanged" });
  });

  it("moves nothing when a fromLastDose dose that is NOT the last one is edited", () => {
    const course = intervalCourse(8);
    const first = makeDose("d1", at(DAY, "06:00"));
    const last = makeDose("d2", at(DAY, "16:00"));
    const events = [first, last];

    expect(
      consequenceFor({ course, events, event: first, chosen: at(DAY, "09:00") }),
    ).toEqual({ kind: "unchanged" });

    // And the engine agrees: the chain still counts from 16:00, untouched.
    const corrected: DoseEvent = {
      ...first,
      id: "d1-corrected",
      givenAt: at(DAY, "09:00").toISOString(),
      supersedesId: "d1",
    };
    expect(nextDueAt(course, [...events, corrected], at(DAY, "05:00"))).toEqual(at(NEXT_DAY, "00:00"));
  });

  it("moves the chain when the LAST dose of a fromLastDose course is edited", () => {
    const course = intervalCourse(8);
    const first = makeDose("d1", at(DAY, "06:00"));
    const last = makeDose("d2", at(DAY, "16:00"));

    const result = consequenceFor({
      course,
      events: [first, last],
      event: last,
      chosen: at(DAY, "15:00"),
    });

    // 15:00 + 8h = 23:00, an hour earlier than the 00:00 the chain sat at.
    expect(result).toEqual({ kind: "moves", next: at(DAY, "23:00"), deltaMin: -60 });
  });

  it("reports the shift as positive when the dose is moved later", () => {
    const course = intervalCourse(8);
    const last = makeDose("d1", at(DAY, "12:00"));
    expect(
      consequenceFor({ course, events: [last], event: last, chosen: at(DAY, "12:45") }),
    ).toEqual({ kind: "moves", next: at(DAY, "20:45"), deltaMin: 45 });
  });

  it("moves nothing when the course is no longer generating occurrences", () => {
    const course = intervalCourse(8);
    const stopped = { ...course, status: "stopped" as const };
    const last = makeDose("d1", at(DAY, "12:00"));
    expect(
      consequenceFor({ course: stopped, events: [last], event: last, chosen: at(DAY, "10:00") }),
    ).toEqual({ kind: "unchanged" });
  });

  it("previews exactly what the engine will compute after the write", () => {
    const course = intervalCourse(6);
    const first = makeDose("d1", at(DAY, "04:00"));
    const last = makeDose("d2", at(DAY, "14:00"));
    const chosen = at(DAY, "13:20");

    const preview = consequenceFor({ course, events: [first, last], event: last, chosen });

    // The real write is a correction row, exactly as `correctDose` appends it.
    const written: DoseEvent = {
      ...last,
      id: "d2-corrected",
      givenAt: chosen.toISOString(),
      loggedAt: now.toISOString(),
      supersedesId: "d2",
    };
    const actual = nextDueAt(course, [first, last, written], chosen);

    expect(preview.kind).toBe("moves");
    expect(preview.kind === "moves" ? preview.next : null).toEqual(actual);
  });
});
