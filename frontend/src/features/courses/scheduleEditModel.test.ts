// Tests for the "shift a course's dose times earlier" pure model.
//
// The runner pins TZ=Europe/London (vitest.config.ts). `stepTime` never
// constructs a `Date` at all — it is minutes-of-day string arithmetic on
// `parseHHMM` output — so nothing here needs a DST date to prove that; the
// comment on `stepTime` itself states why no `Date` ever enters the
// function. `gapWarningFor`'s "given event today" branch DOES read `now`
// and `DoseEvent.givenAt`, so those cases build real local `Date`s the
// ordinary way.
import { describe, expect, it } from "vitest";
import type { DoseEvent, Schedule } from "@/domain";
import { occurrenceKeyFor } from "@/domain";
import { gapWarningFor, SCHEDULE_STEP_MIN, stepTime } from "./scheduleEditModel";

describe("SCHEDULE_STEP_MIN", () => {
  it("is 15, not logAtTimeModel's 5 — a schedule grid, not a corrected instant", () => {
    expect(SCHEDULE_STEP_MIN).toBe(15);
  });
});

describe("stepTime", () => {
  it("clamps at 00:00 rather than wrapping to the previous day", () => {
    expect(stepTime("00:00", -15)).toBe("00:00");
    expect(stepTime("00:10", -15)).toBe("00:00");
  });

  it("clamps at 23:45 rather than wrapping to the next day", () => {
    expect(stepTime("23:45", 15)).toBe("23:45");
    expect(stepTime("23:40", 15)).toBe("23:45");
  });

  it("steps up across an hour boundary", () => {
    expect(stepTime("07:50", 15)).toBe("08:05");
  });

  it("steps down across an hour boundary", () => {
    expect(stepTime("08:05", -15)).toBe("07:50");
  });

  it("is pure string arithmetic — repeated calls with the same input always agree", () => {
    // No `now`/`Date` parameter exists to vary; calling it many times from
    // "different points in time" (there are none here) cannot change the
    // answer, which is the whole point of keeping this off `Date` entirely.
    for (let i = 0; i < 5; i++) {
      expect(stepTime("09:00", 30)).toBe("09:30");
    }
  });
});

let eventSeq = 0;
function givenEvent(courseId: string, givenAt: Date, overrides: Partial<DoseEvent> = {}): DoseEvent {
  eventSeq += 1;
  const iso = givenAt.toISOString();
  return {
    id: `event-${eventSeq}`,
    courseId,
    scheduledFor: null,
    status: "given",
    loggedAt: iso,
    givenAt: iso,
    amount: 0.4,
    note: null,
    occurrenceKey: occurrenceKeyFor(courseId, null),
    supersedesId: null,
    actorId: "actor-1",
    createdAt: iso,
    updatedAt: iso,
    deletedAt: null,
    ...overrides,
  };
}

const COURSE_ID = "course-1";

describe("gapWarningFor — fixedTimes", () => {
  it("the approved mock case: {08:00, 18:00} (gaps 10h/14h, expected 12h) -> tooSoon", () => {
    const next: Schedule = { kind: "fixedTimes", times: ["08:00", "18:00"] };
    const previous: Schedule = { kind: "fixedTimes", times: ["08:00", "20:00"] };
    const result = gapWarningFor({
      next,
      previous,
      events: [],
      courseId: COURSE_ID,
      now: new Date(2026, 7, 11, 12, 0),
    });
    expect(result).toEqual({
      kind: "tooSoon",
      gapMinutes: 600,
      expectedMinutes: 720,
      sinceTime: "08:00",
    });
  });

  it("{08:00, 20:00} — exactly the expected 12h spacing — warns about nothing", () => {
    const next: Schedule = { kind: "fixedTimes", times: ["08:00", "20:00"] };
    const previous: Schedule = { kind: "fixedTimes", times: ["08:00", "20:00"] };
    expect(
      gapWarningFor({ next, previous, events: [], courseId: COURSE_ID, now: new Date(2026, 7, 11, 12, 0) }),
    ).toBeNull();
  });

  it("computes the gap across a midnight wrap ({22:00, 02:00})", () => {
    const next: Schedule = { kind: "fixedTimes", times: ["22:00", "02:00"] };
    const previous: Schedule = { kind: "fixedTimes", times: ["22:00", "02:00"] };
    const result = gapWarningFor({
      next,
      previous,
      events: [],
      courseId: COURSE_ID,
      now: new Date(2026, 7, 11, 12, 0),
    });
    expect(result).toEqual({
      kind: "tooSoon",
      gapMinutes: 240,
      expectedMinutes: 720,
      sinceTime: "22:00",
    });
  });

  it("below GRACE_FIXED_MIN (60): tooSoonToLog, because the second dose could not physically be logged", () => {
    const next: Schedule = { kind: "fixedTimes", times: ["08:00", "08:30"] };
    const previous: Schedule = { kind: "fixedTimes", times: ["08:00", "20:00"] };
    const result = gapWarningFor({
      next,
      previous,
      events: [],
      courseId: COURSE_ID,
      now: new Date(2026, 7, 11, 12, 0),
    });
    expect(result).toEqual({ kind: "tooSoonToLog", gapMinutes: 30, sinceTime: "08:00" });
  });

  it("reports the gap since a real given event today when it is smaller than the grid gap", () => {
    // Grid gap for {08:00, 20:00} is a clean 12h (720 min) — no warning on
    // its own. But a dose was actually given at 19:00 today, so the next
    // slot (20:00) is really only 60 minutes away.
    const next: Schedule = { kind: "fixedTimes", times: ["08:00", "20:00"] };
    const previous: Schedule = { kind: "fixedTimes", times: ["08:00", "20:00"] };
    const now = new Date(2026, 7, 11, 20, 30);
    const events = [givenEvent(COURSE_ID, new Date(2026, 7, 11, 19, 0))];
    const result = gapWarningFor({ next, previous, events, courseId: COURSE_ID, now });
    expect(result).toEqual({
      kind: "tooSoon",
      gapMinutes: 60,
      expectedMinutes: 720,
      sinceTime: "19:00",
    });
  });

  it("ignores a given event from a different course, and a given event from a different day", () => {
    const next: Schedule = { kind: "fixedTimes", times: ["08:00", "20:00"] };
    const previous: Schedule = { kind: "fixedTimes", times: ["08:00", "20:00"] };
    const now = new Date(2026, 7, 11, 20, 30);
    const events = [
      givenEvent("some-other-course", new Date(2026, 7, 11, 19, 0)),
      givenEvent(COURSE_ID, new Date(2026, 7, 10, 19, 0)), // yesterday
    ];
    expect(gapWarningFor({ next, previous, events, courseId: COURSE_ID, now })).toBeNull();
  });
});

describe("gapWarningFor — fromLastDose", () => {
  it("shortening 12h -> 10h warns", () => {
    const next: Schedule = { kind: "fromLastDose", intervalHours: 10 };
    const previous: Schedule = { kind: "fromLastDose", intervalHours: 12 };
    const result = gapWarningFor({
      next,
      previous,
      events: [],
      courseId: COURSE_ID,
      now: new Date(2026, 7, 11, 12, 0),
    });
    expect(result).toEqual({ kind: "tooSoon", gapMinutes: 600, expectedMinutes: 720, sinceTime: null });
  });

  it("lengthening 12h -> 14h does not warn", () => {
    const next: Schedule = { kind: "fromLastDose", intervalHours: 14 };
    const previous: Schedule = { kind: "fromLastDose", intervalHours: 12 };
    expect(
      gapWarningFor({ next, previous, events: [], courseId: COURSE_ID, now: new Date(2026, 7, 11, 12, 0) }),
    ).toBeNull();
  });

  it("below GRACE_FIXED_MIN (e.g. 12h -> 30min) is tooSoonToLog, with no sinceTime", () => {
    const next: Schedule = { kind: "fromLastDose", intervalHours: 0.5 };
    const previous: Schedule = { kind: "fromLastDose", intervalHours: 12 };
    const result = gapWarningFor({
      next,
      previous,
      events: [],
      courseId: COURSE_ID,
      now: new Date(2026, 7, 11, 12, 0),
    });
    expect(result).toEqual({ kind: "tooSoonToLog", gapMinutes: 30, sinceTime: null });
  });
});
