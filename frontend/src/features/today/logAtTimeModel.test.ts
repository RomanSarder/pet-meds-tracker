// Tests for SPEC §6.1a's pure model.
//
// NO `vi.mock("@/engine")` HERE, deliberately — unlike the rest of slice 5's
// tests, which drive the `testEngine` double. `consequenceFor` exists to
// preview what the real scheduler will do after the write, so a stubbed
// `nextDueAt` would make every consequence assertion vacuous. The point is to
// test against the real chain arithmetic in `engine/sweep.ts`.
//
// The runner pins TZ=Europe/London (vitest.config.ts), so the two DST dates
// below are real transitions: 2026-03-29 (01:00 → 02:00, a 23-hour day) and
// 2026-10-25 (02:00 → 01:00, a 25-hour day).
import { describe, expect, it } from "vitest";
import type { Course, DoseEvent, LocalDate, Schedule } from "@/domain";
import { FIXTURE_NOW, occurrenceKeyFor, startOfLocalDay } from "@/domain";
import type { Occurrence } from "@/engine";
import {
  atOffset,
  boundsFor,
  canConfirm,
  canStepEarlier,
  canStepLater,
  consequenceFor,
  DAY_CHECK_HOURS,
  DEFAULT_OFFSET_MIN,
  elapsedSince,
  helperFor,
  OFFSET_CHOICES_MIN,
  scheduledChoice,
  stepBy,
  STEP_MIN,
} from "./logAtTimeModel";

const MIN = 60_000;
const HOUR = 3_600_000;

let courseSeq = 0;
function makeCourse(overrides: Partial<Course> & { schedule: Schedule }): Course {
  courseSeq += 1;
  return {
    id: `course-${courseSeq}`,
    petId: "pet-1",
    medicationId: "med-1",
    doseAmount: 0.4,
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
function givenEvent(course: Course, givenAt: Date, overrides: Partial<DoseEvent> = {}): DoseEvent {
  eventSeq += 1;
  const iso = givenAt.toISOString();
  return {
    id: `event-${eventSeq}`,
    courseId: course.id,
    scheduledFor: null,
    status: "given",
    loggedAt: iso,
    givenAt: iso,
    amount: course.doseAmount,
    note: null,
    occurrenceKey: occurrenceKeyFor(course.id, null),
    supersedesId: null,
    actorId: "actor-1",
    createdAt: iso,
    updatedAt: iso,
    deletedAt: null,
    ...overrides,
  };
}

function makeOccurrence(course: Course, day: LocalDate, dueAt: Date | null): Occurrence {
  const scheduledFor = dueAt === null ? null : dueAt.toISOString();
  return {
    key: occurrenceKeyFor(course.id, scheduledFor),
    courseId: course.id,
    petId: course.petId,
    medicationId: course.medicationId,
    kind: course.schedule.kind,
    day,
    dueAt,
    graceMinutes: course.schedule.kind === "fixedTimes" ? 60 : 90,
    doseAmount: course.doseAmount,
    doseUnit: course.doseUnit,
    instructions: course.instructions,
    event: null,
  };
}

/** 2026-08-08 is the fixtures' Saturday; every non-DST case below sits on it. */
const DAY: LocalDate = "2026-08-08";
function at(hours: number, minutes = 0): Date {
  return new Date(2026, 7, 8, hours, minutes);
}

describe("boundsFor", () => {
  it("floors at local midnight of now's day and ceilings at now", () => {
    const now = new Date(2026, 7, 8, 14, 37, 12, 345);
    const { floor, ceiling } = boundsFor(now);
    expect(floor.getTime()).toBe(new Date(2026, 7, 8, 0, 0, 0, 0).getTime());
    expect(floor.getTime()).toBe(startOfLocalDay(now).getTime());
    expect(ceiling.getTime()).toBe(now.getTime());
  });

  it("returns fresh Dates, so a caller cannot mutate now through them", () => {
    const now = new Date(2026, 7, 8, 14, 0);
    const { ceiling } = boundsFor(now);
    ceiling.setFullYear(1999);
    expect(now.getFullYear()).toBe(2026);
  });
});

describe("the SPEC §12 clamp invariant", () => {
  // "The corrected-time picker cannot produce a `givenAt` in the future or
  // before 00:00 today." Every value the sheet can reach — every chip, and
  // every stepper walk from every chip, in both directions — is generated and
  // checked, rather than sampled by hand.
  const nows: Array<[string, Date]> = [
    ["FIXTURE_NOW (08:00 BST)", new Date(FIXTURE_NOW)],
    ["00:02 local", new Date(2026, 7, 8, 0, 2)],
    ["exactly 00:00:00.000 local", new Date(2026, 7, 8, 0, 0, 0, 0)],
    ["23:59 local", new Date(2026, 7, 8, 23, 59)],
    ["2026-03-29 01:30 local (spring forward)", new Date(2026, 2, 29, 1, 30)],
    ["2026-10-25 01:30 local (fall back)", new Date(2026, 9, 25, 1, 30)],
  ];

  for (const [label, now] of nows) {
    for (const minutes of OFFSET_CHOICES_MIN) {
      for (const direction of [-1, 1]) {
        it(`holds at ${label}, ${minutes} min ago, stepping ${direction > 0 ? "later" : "earlier"}`, () => {
          const { floor, ceiling } = boundsFor(now);
          let current = atOffset(minutes, now);
          for (let step = 0; step <= 40; step++) {
            expect(current.getTime()).toBeGreaterThanOrEqual(floor.getTime());
            expect(current.getTime()).toBeLessThanOrEqual(ceiling.getTime());
            expect(canConfirm(current, now)).toBe(true);
            current = stepBy(current, direction * STEP_MIN, now);
          }
        });
      }
    }
  }
});

describe("clamping and the stepper", () => {
  it("clamps a 2 h offset to exactly midnight when now is 00:30", () => {
    const now = at(0, 30);
    expect(atOffset(120, now).getTime()).toBe(at(0, 0).getTime());
  });

  it("clamps a step past now back to now, rather than overshooting", () => {
    const now = at(14, 0);
    const current = new Date(now.getTime() - 1 * MIN);
    expect(stepBy(current, STEP_MIN, now).getTime()).toBe(now.getTime());
  });

  it("cannot step later at exactly now, or earlier at exactly midnight", () => {
    const now = at(14, 0);
    const { floor } = boundsFor(now);
    expect(canStepLater(now, now)).toBe(false);
    expect(canStepLater(new Date(now.getTime() - 1), now)).toBe(true);
    expect(canStepEarlier(floor, now)).toBe(false);
    expect(canStepEarlier(new Date(floor.getTime() + 1), now)).toBe(true);
  });

  it("refuses to confirm one millisecond past now or one before midnight", () => {
    const now = at(14, 0);
    const { floor } = boundsFor(now);
    expect(canConfirm(new Date(now.getTime() + 1), now)).toBe(false);
    expect(canConfirm(new Date(now.getTime()), now)).toBe(true);
    expect(canConfirm(new Date(floor.getTime() - 1), now)).toBe(false);
    expect(canConfirm(floor, now)).toBe(true);
  });

  it("defaults to 30 minutes ago, which is one of the offered chips", () => {
    const now = at(14, 0);
    expect(OFFSET_CHOICES_MIN).toContain(DEFAULT_OFFSET_MIN);
    expect(atOffset(DEFAULT_OFFSET_MIN, now).getTime()).toBe(at(13, 30).getTime());
  });
});

describe("scheduledChoice", () => {
  const course = makeCourse({ schedule: { kind: "fixedTimes", times: ["08:00"] } });

  it("returns the occurrence's dueAt by value, not now and not a clamped derivative", () => {
    const dueAt = at(8, 0);
    const now = at(14, 0);
    const chosen = scheduledChoice(makeOccurrence(course, DAY, dueAt));
    expect(chosen).not.toBeNull();
    expect(chosen?.getTime()).toBe(dueAt.getTime());
    expect(chosen?.getTime()).not.toBe(now.getTime());
  });

  it("returns a FUTURE dueAt unclamped, so the berry headline and disabled footer are reachable", () => {
    const dueAt = at(20, 0);
    const now = at(14, 0);
    const chosen = scheduledChoice(makeOccurrence(course, DAY, dueAt));
    expect(chosen?.getTime()).toBe(dueAt.getTime());
    // The value is offered; `canConfirm` is what upholds the §12 invariant.
    expect(canConfirm(chosen as Date, now)).toBe(false);
    expect(helperFor(chosen as Date, dueAt, now)).toEqual({ kind: "futureCap" });
  });

  it("returns null for an unanchored chain with no dueAt", () => {
    const interval = makeCourse({ schedule: { kind: "fromLastDose", intervalHours: 8 } });
    expect(scheduledChoice(makeOccurrence(interval, DAY, null))).toBeNull();
  });

  it("returns null for a cross-midnight occurrence, which §4 sends to history", () => {
    const dueAt = new Date(2026, 7, 7, 23, 0);
    expect(scheduledChoice(makeOccurrence(course, DAY, dueAt))).toBeNull();
  });

  it("uses the same midnight the sheet's floor uses, for an occurrence filed under today", () => {
    const now = at(14, 0);
    expect(new Date(2026, 7, 8, 0, 0).getTime()).toBe(boundsFor(now).floor.getTime());
  });
});

describe("elapsedSince", () => {
  const now = at(14, 0);

  it("reports 30 minutes", () => {
    expect(elapsedSince(new Date(now.getTime() - 30 * MIN), now)).toEqual({
      hours: 0,
      minutes: 30,
    });
  });

  it("reports one whole hour", () => {
    expect(elapsedSince(new Date(now.getTime() - 60 * MIN), now)).toEqual({
      hours: 1,
      minutes: 0,
    });
  });

  it("splits 135 minutes into 2 h 15", () => {
    expect(elapsedSince(new Date(now.getTime() - 135 * MIN), now)).toEqual({
      hours: 2,
      minutes: 15,
    });
  });

  it("is zero at exactly now, and never negative in the future", () => {
    expect(elapsedSince(now, now)).toEqual({ hours: 0, minutes: 0 });
    expect(elapsedSince(new Date(now.getTime() + 90 * MIN), now)).toEqual({
      hours: 0,
      minutes: 0,
    });
  });

  it("floors a partial minute instead of rounding it up", () => {
    const chosen = new Date(now.getTime() - (30 * MIN + 59_999));
    expect(elapsedSince(chosen, now)).toEqual({ hours: 0, minutes: 30 });
  });
});

describe("helperFor", () => {
  const now = at(14, 0);

  it("puts futureCap ahead of a day-check that would also apply", () => {
    const scheduledAt = new Date(now.getTime() + 20 * HOUR);
    expect(helperFor(now, scheduledAt, now)).toEqual({ kind: "futureCap" });
  });

  it("fires the day-check one minute past 12 h before the scheduled time", () => {
    const chosen = new Date(now.getTime() - 5 * MIN);
    const scheduledAt = new Date(chosen.getTime() + DAY_CHECK_HOURS * HOUR + MIN);
    expect(helperFor(chosen, scheduledAt, now)).toEqual({
      kind: "dayCheck",
      hours: DAY_CHECK_HOURS,
    });
  });

  it("does NOT fire the day-check at exactly 12 h", () => {
    const chosen = new Date(now.getTime() - 5 * MIN);
    const scheduledAt = new Date(chosen.getTime() + DAY_CHECK_HOURS * HOUR);
    expect(helperFor(chosen, scheduledAt, now)).toEqual({ kind: "range" });
  });

  it("falls back to the range helper when there is no scheduled time at all", () => {
    const chosen = new Date(now.getTime() - 20 * HOUR);
    expect(helperFor(chosen, null, now)).toEqual({ kind: "range" });
  });
});

describe("consequenceFor · fromLastDose", () => {
  it("moves the chain by the lateness (SPEC §12: 90 minutes late, 90 minutes later)", () => {
    const course = makeCourse({ schedule: { kind: "fromLastDose", intervalHours: 8 } });
    const events = [givenEvent(course, at(0, 0))];
    const occurrence = makeOccurrence(course, DAY, at(8, 0));

    const result = consequenceFor({ course, events, occurrence, chosen: at(9, 30) });

    expect(result.kind).toBe("moves");
    if (result.kind !== "moves") return;
    expect(result.next.getTime()).toBe(at(17, 30).getTime());
    expect(result.deltaMin).toBe(90);
  });

  it("stays on the planned grid when logged at its scheduled time (SPEC §12)", () => {
    const course = makeCourse({ schedule: { kind: "fromLastDose", intervalHours: 8 } });
    const events = [givenEvent(course, at(0, 0))];
    const dueAt = at(8, 0);
    const occurrence = makeOccurrence(course, DAY, dueAt);

    const result = consequenceFor({ course, events, occurrence, chosen: dueAt });

    expect(result.kind).toBe("stays");
    if (result.kind !== "stays") return;
    expect(result.next.getTime()).toBe(at(16, 0).getTime());
    expect(result.lateMin).toBeNull();
  });

  it("stays when a live given event is already LATER than the chosen time", () => {
    // `anchorFor` takes the NEWEST given event, so this write never becomes the
    // anchor: the chain does not move, and calling it "moves" would be a lie.
    const course = makeCourse({ schedule: { kind: "fromLastDose", intervalHours: 8 } });
    const events = [givenEvent(course, at(0, 0)), givenEvent(course, at(12, 0))];
    const occurrence = makeOccurrence(course, DAY, at(8, 0));

    const result = consequenceFor({ course, events, occurrence, chosen: at(9, 30) });

    expect(result.kind).toBe("stays");
    if (result.kind !== "stays") return;
    expect(result.next.getTime()).toBe(at(20, 0).getTime());
    expect(result.lateMin).toBe(90);
  });

  it("previews the first dose of an unanchored chain with no planned time to compare", () => {
    const course = makeCourse({ schedule: { kind: "fromLastDose", intervalHours: 8 } });
    const occurrence = makeOccurrence(course, DAY, null);

    const result = consequenceFor({ course, events: [], occurrence, chosen: at(9, 30) });

    expect(result.kind).toBe("moves");
    if (result.kind !== "moves") return;
    expect(result.next.getTime()).toBe(at(17, 30).getTime());
    // 0 is the "no planned time" sentinel: a real zero shift is reported as
    // `stays`, so it can never appear on a `moves` result.
    expect(result.deltaMin).toBe(0);
  });

  it("reports none for a paused course", () => {
    const course = makeCourse({
      schedule: { kind: "fromLastDose", intervalHours: 8 },
      status: "paused",
    });
    const events = [givenEvent(course, at(0, 0))];
    const occurrence = makeOccurrence(course, DAY, at(8, 0));

    expect(consequenceFor({ course, events, occurrence, chosen: at(9, 30) })).toEqual({
      kind: "none",
    });
  });
});

describe("consequenceFor · fixedTimes", () => {
  it("keeps the following dose on the grid and names the lateness", () => {
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["08:00", "20:00"] },
    });
    const occurrence = makeOccurrence(course, DAY, at(8, 0));

    const result = consequenceFor({ course, events: [], occurrence, chosen: at(9, 30) });

    expect(result.kind).toBe("stays");
    if (result.kind !== "stays") return;
    expect(result.next.getTime()).toBe(at(20, 0).getTime());
    expect(result.lateMin).toBe(90);
  });

  it("returns the same next dose whatever the user picks", () => {
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["08:00", "20:00"] },
    });
    const occurrence = makeOccurrence(course, DAY, at(8, 0));
    const base = { course, events: [] as DoseEvent[], occurrence };

    const early = consequenceFor({ ...base, chosen: at(8, 5) });
    const late = consequenceFor({ ...base, chosen: at(11, 45) });

    expect(early.kind).toBe("stays");
    expect(late.kind).toBe("stays");
    if (early.kind !== "stays" || late.kind !== "stays") return;
    expect(early.next.getTime()).toBe(late.next.getTime());
    expect(late.next.getTime()).toBe(at(20, 0).getTime());
  });

  it("rolls a once-daily course to tomorrow when the only slot has passed", () => {
    const course = makeCourse({ schedule: { kind: "fixedTimes", times: ["20:00"] } });
    const occurrence = makeOccurrence(course, DAY, at(20, 0));

    const result = consequenceFor({ course, events: [], occurrence, chosen: at(20, 30) });

    expect(result.kind).toBe("stays");
    if (result.kind !== "stays") return;
    expect(result.next.getTime()).toBe(new Date(2026, 7, 9, 20, 0).getTime());
    expect(result.lateMin).toBe(30);
  });

  it("reports null lateness, never a negative, for a dose given early", () => {
    const course = makeCourse({ schedule: { kind: "fixedTimes", times: ["08:00"] } });
    const occurrence = makeOccurrence(course, DAY, at(8, 0));

    const result = consequenceFor({ course, events: [], occurrence, chosen: at(7, 45) });

    expect(result.kind).toBe("stays");
    if (result.kind !== "stays") return;
    expect(result.lateMin).toBeNull();
  });

  it("reports none for a course past its endDate", () => {
    const course = makeCourse({
      schedule: { kind: "fixedTimes", times: ["08:00"] },
      endDate: "2026-08-07",
    });
    const occurrence = makeOccurrence(course, DAY, at(8, 0));

    expect(consequenceFor({ course, events: [], occurrence, chosen: at(9, 30) })).toEqual({
      kind: "none",
    });
  });
});
