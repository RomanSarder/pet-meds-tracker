// DST correctness for the scheduling engine (SPEC §3d, W2-DECISIONS.md §11).
// Europe/London is pinned by vitest.config.ts. Real 2026 shift dates:
//   spring forward 2026-03-29 (01:00 GMT -> 02:00 BST, a 23h local day)
//   autumn back    2026-10-25 (02:00 BST -> 01:00 GMT, a 25h local day)
import { describe, expect, it } from "vitest";
import type { Course, CourseEvent, DoseEvent, IsoWeekday } from "@/domain";
import { atLocalTime, formatHHMM, localDayKey, occurrenceKeyFor } from "@/domain";
import type { EngineContext } from "./engine.types";
import { getOccurrences } from "./index";

function fixedTimesCourse(
  id: string,
  times: string[],
  opts: {
    startDate: string;
    endDate?: string | null;
    daysOfWeek?: IsoWeekday[];
    everyNDays?: number;
  },
): Course {
  return {
    id,
    petId: "pet-1",
    medicationId: "med-1",
    doseAmount: 1,
    doseUnit: "ml",
    instructions: null,
    schedule: {
      kind: "fixedTimes",
      times,
      ...(opts.daysOfWeek ? { daysOfWeek: opts.daysOfWeek } : {}),
      ...(opts.everyNDays ? { everyNDays: opts.everyNDays } : {}),
    },
    startDate: opts.startDate,
    endDate: opts.endDate ?? null,
    status: "active",
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
  opts: { startDate: string; endDate?: string | null },
): Course {
  return {
    id,
    petId: "pet-1",
    medicationId: "med-1",
    doseAmount: 1,
    doseUnit: "ml",
    instructions: null,
    schedule: { kind: "fromLastDose", intervalHours },
    startDate: opts.startDate,
    endDate: opts.endDate ?? null,
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
      startDate: "2026-01-01",
      endDate: null,
    },
    after: {
      schedule: { kind: "fixedTimes", times: overrides.after },
      doseAmount: 1,
      doseUnit: "ml",
      startDate: "2026-01-01",
      endDate: null,
    },
    createdAt: overrides.at,
    updatedAt: overrides.at,
    deletedAt: null,
  };
}

describe("fixedTimes preserves wall-clock time across DST shifts", () => {
  it("keeps 08:00 local across the March 2026 spring-forward shift (2026-03-28 .. 2026-03-30)", () => {
    const course = fixedTimesCourse("dst-fwd", ["08:00"], { startDate: "2026-01-01" });
    const ctx: EngineContext = { courses: [course], events: [], courseEvents: [] };

    const before = getOccurrences("2026-03-28", ctx)[0];
    const shiftDay = getOccurrences("2026-03-29", ctx)[0];
    const after = getOccurrences("2026-03-30", ctx)[0];

    expect(formatHHMM(before.dueAt!)).toBe("08:00");
    expect(formatHHMM(shiftDay.dueAt!)).toBe("08:00");
    expect(formatHHMM(after.dueAt!)).toBe("08:00");

    // The UTC offset actually changed between the 28th (GMT, UTC+0) and the
    // 29th (BST, UTC+1) — proof this is wall-clock arithmetic, not
    // millisecond arithmetic, which would have kept the same UTC hour.
    expect(before.dueAt!.toISOString()).toBe("2026-03-28T08:00:00.000Z");
    expect(shiftDay.dueAt!.toISOString()).toBe("2026-03-29T07:00:00.000Z");
    expect(before.dueAt!.toISOString()).not.toBe(shiftDay.dueAt!.toISOString());
  });

  it("keeps 08:00 local across the October 2026 autumn-back shift (2026-10-24 .. 2026-10-26)", () => {
    const course = fixedTimesCourse("dst-back", ["08:00"], { startDate: "2026-01-01" });
    const ctx: EngineContext = { courses: [course], events: [], courseEvents: [] };

    const before = getOccurrences("2026-10-24", ctx)[0];
    const shiftDay = getOccurrences("2026-10-25", ctx)[0];
    const after = getOccurrences("2026-10-26", ctx)[0];

    expect(formatHHMM(before.dueAt!)).toBe("08:00");
    expect(formatHHMM(shiftDay.dueAt!)).toBe("08:00");
    expect(formatHHMM(after.dueAt!)).toBe("08:00");

    // Offset changes between the 24th (BST, UTC+1) and the 25th (GMT from
    // 01:00 GMT onward, UTC+0) — the shift instant falls before 08:00 local
    // on the 25th itself.
    expect(before.dueAt!.toISOString()).toBe("2026-10-24T07:00:00.000Z");
    expect(shiftDay.dueAt!.toISOString()).toBe("2026-10-25T08:00:00.000Z");
    expect(before.dueAt!.toISOString()).not.toBe(shiftDay.dueAt!.toISOString());
  });
});

describe("fromLastDose preserves elapsed real time (not wall clock) across DST shifts", () => {
  it("a 12h chain anchored 2026-03-28T20:00 local lands 12 real hours later, at a different wall-clock time (09:00 on 2026-03-29)", () => {
    const course = fromLastDoseCourse("dst-fwd-chain", 12, { startDate: "2026-03-01" });
    const anchor = atLocalTime("2026-03-28", "20:00");
    const event = givenEvent("dst-fwd-chain-ev", course.id, {
      scheduledFor: null,
      givenAt: anchor.toISOString(),
    });
    const ctx: EngineContext = { courses: [course], events: [event], courseEvents: [] };

    const occs = getOccurrences("2026-03-29", ctx);
    expect(occs).toHaveLength(1);
    const occ = occs[0];

    // Elapsed milliseconds, proving this is NOT wall-clock reconstruction
    // (which would have swapped in 08:00 local, the same clock time as the
    // anchor).
    expect(occ.dueAt!.getTime() - anchor.getTime()).toBe(12 * 3_600_000);
    expect(formatHHMM(occ.dueAt!)).toBe("09:00");
    expect(localDayKey(occ.dueAt!)).toBe("2026-03-29");
  });

  it("a 12h chain anchored 2026-10-24T20:00 local lands 12 real hours later, at a different wall-clock time (07:00 on 2026-10-25)", () => {
    const course = fromLastDoseCourse("dst-back-chain", 12, { startDate: "2026-10-01" });
    const anchor = atLocalTime("2026-10-24", "20:00");
    const event = givenEvent("dst-back-chain-ev", course.id, {
      scheduledFor: null,
      givenAt: anchor.toISOString(),
    });
    const ctx: EngineContext = { courses: [course], events: [event], courseEvents: [] };

    const occs = getOccurrences("2026-10-25", ctx);
    expect(occs).toHaveLength(1);
    const occ = occs[0];

    expect(occ.dueAt!.getTime() - anchor.getTime()).toBe(12 * 3_600_000);
    expect(formatHHMM(occ.dueAt!)).toBe("07:00");
    expect(localDayKey(occ.dueAt!)).toBe("2026-10-25");
  });
});

describe("everyNDays counts calendar days, not ms / 86_400_000, across the March 2026 shift", () => {
  it("fires on 2026-03-29 — an even number of calendar days after the 2026-03-01 start", () => {
    const course = fixedTimesCourse("every-n-days-hit", ["09:00"], {
      startDate: "2026-03-01",
      everyNDays: 2,
    });
    const ctx: EngineContext = { courses: [course], events: [], courseEvents: [] };

    expect(getOccurrences("2026-03-29", ctx)).toHaveLength(1);
  });

  it("does not fire on 2026-03-28 or 2026-03-30 — odd numbers of calendar days after the start, either side of the shift", () => {
    const course = fixedTimesCourse("every-n-days-miss", ["09:00"], {
      startDate: "2026-03-01",
      everyNDays: 2,
    });
    const ctx: EngineContext = { courses: [course], events: [], courseEvents: [] };

    expect(getOccurrences("2026-03-28", ctx)).toHaveLength(0);
    expect(getOccurrences("2026-03-30", ctx)).toHaveLength(0);
  });
});

describe("daysOfWeek uses ISO weekday numbering (1 = Monday .. 7 = Sunday), never JS getDay()", () => {
  it("a daysOfWeek:[7] course fires on Sunday 2026-08-09, not on the Monday after (2026-08-10)", () => {
    const course = fixedTimesCourse("sunday-course", ["09:00"], {
      startDate: "2026-08-01",
      daysOfWeek: [7],
    });
    const ctx: EngineContext = { courses: [course], events: [], courseEvents: [] };

    expect(getOccurrences("2026-08-09", ctx)).toHaveLength(1);
    expect(getOccurrences("2026-08-10", ctx)).toHaveLength(0);
  });

  it("a daysOfWeek:[1] course fires on Monday 2026-08-10, not on the Sunday before (2026-08-09)", () => {
    const course = fixedTimesCourse("monday-course", ["09:00"], {
      startDate: "2026-08-01",
      daysOfWeek: [1],
    });
    const ctx: EngineContext = { courses: [course], events: [], courseEvents: [] };

    expect(getOccurrences("2026-08-10", ctx)).toHaveLength(1);
    expect(getOccurrences("2026-08-09", ctx)).toHaveLength(0);
  });
});

// SPEC §3c: a schedule edit's forward-only day split must still be computed
// in wall-clock terms across a DST boundary — the day before an edit that
// lands near the shift keeps the OLD grid's wall-clock time exactly, not an
// hour off from naive UTC-offset-carrying arithmetic.
describe("a schedule edit near a DST shift keeps the OLD grid's wall-clock time on the day before it", () => {
  it("spring-forward 2026-03-29: 2026-03-28 still shows the OLD grid's 20:00 in wall-clock time", () => {
    const course = fixedTimesCourse("dst-edit-spring", ["08:00", "18:00"], { startDate: "2026-01-01" });
    const edited = makeEditedEvent({
      courseId: course.id,
      at: atLocalTime("2026-03-29", "13:00").toISOString(),
      before: ["08:00", "20:00"],
      after: ["08:00", "18:00"],
    });
    const ctx: EngineContext = { courses: [course], events: [], courseEvents: [edited] };

    const occs = getOccurrences("2026-03-28", ctx);
    const evening = occs.find((o) => o.dueAt!.getHours() === 20)!;
    expect(formatHHMM(evening.dueAt!)).toBe("20:00");
    // GMT (UTC+0) on the 28th, the day before the shift.
    expect(evening.dueAt!.toISOString()).toBe("2026-03-28T20:00:00.000Z");
  });

  it("autumn-back 2026-10-25: 2026-10-24 still shows the OLD grid's 20:00 in wall-clock time", () => {
    const course = fixedTimesCourse("dst-edit-autumn", ["08:00", "18:00"], { startDate: "2026-01-01" });
    const edited = makeEditedEvent({
      courseId: course.id,
      at: atLocalTime("2026-10-25", "13:00").toISOString(),
      before: ["08:00", "20:00"],
      after: ["08:00", "18:00"],
    });
    const ctx: EngineContext = { courses: [course], events: [], courseEvents: [edited] };

    const occs = getOccurrences("2026-10-24", ctx);
    const evening = occs.find((o) => o.dueAt!.getHours() === 20)!;
    expect(formatHHMM(evening.dueAt!)).toBe("20:00");
    // BST (UTC+1) on the 24th, the day before the shift.
    expect(evening.dueAt!.toISOString()).toBe("2026-10-24T19:00:00.000Z");
  });
});
