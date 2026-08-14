import { describe, expect, it } from "vitest";
import type { Course, CourseEvent, CourseSnapshot, DoseEvent, Medication } from "@/domain";
import { createTranslator } from "@/i18n";
import { renderDayHeading, renderDetail } from "@/i18n/history";
import {
  buildLogEntries,
  dayHeading,
  filterEntries,
  groupByDay,
  summarise,
  type LogEntry,
  type LogSource,
} from "./logModel";

const TS = "2026-08-01T00:00:00.000Z";

// This module is locale-free: it emits `DetailClause[]`, not prose. The
// English literals below are the strings it used to build itself, and they
// stay pinned here — rendered through the wording layer rather than read off
// the entry — so a regression in either half still fails this file.
const en = createTranslator("en");

function detailOf(entry: LogEntry): string {
  return renderDetail(entry.detail, en);
}

function makeMedication(overrides: Partial<Medication> = {}): Medication {
  return {
    id: "med-1",
    name: "Metacam",
    strength: null,
    form: "liquid",
    unit: "ml",
    packSize: null,
    stockUnits: null,
    lowThreshold: null,
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
    ...overrides,
  };
}

function makeCourse(overrides: Partial<Course> = {}): Course {
  return {
    id: "course-1",
    petId: "pet-1",
    medicationId: "med-1",
    doseAmount: 0.4,
    doseUnit: "ml",
    instructions: null,
    schedule: { kind: "fixedTimes", times: ["08:00"] },
    startDate: "2026-08-01",
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

function makeDoseEvent(overrides: Partial<DoseEvent> = {}): DoseEvent {
  return {
    id: "dose-1",
    courseId: "course-1",
    scheduledFor: null,
    status: "given",
    loggedAt: TS,
    givenAt: TS,
    amount: 0.4,
    note: null,
    occurrenceKey: "course-1|-",
    supersedesId: null,
    actorId: "user-1",
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
    ...overrides,
  };
}

const defaultSnapshot: CourseSnapshot = {
  schedule: { kind: "fixedTimes", times: ["08:00"] },
  doseAmount: 0.4,
  doseUnit: "ml",
  startDate: "2026-08-01",
  endDate: null,
};

function makeCourseEvent(overrides: Partial<CourseEvent> = {}): CourseEvent {
  return {
    id: "cev-1",
    courseId: "course-1",
    kind: "started",
    at: TS,
    seq: 1,
    actorId: "user-1",
    before: null,
    after: defaultSnapshot,
    createdAt: TS,
    updatedAt: TS,
    deletedAt: null,
    ...overrides,
  };
}

function srcOf(partial: Partial<LogSource>): LogSource {
  return {
    courses: [],
    medications: [],
    doseEvents: [],
    courseEvents: [],
    ...partial,
  };
}

describe("buildLogEntries", () => {
  it("skips a dose event whose course cannot be found, without throwing", () => {
    const entries = buildLogEntries(
      srcOf({ doseEvents: [makeDoseEvent({ courseId: "missing-course" })] }),
    );
    expect(entries).toEqual([]);
  });

  it("skips a course event whose course cannot be found, without throwing", () => {
    const entries = buildLogEntries(
      srcOf({ courseEvents: [makeCourseEvent({ courseId: "missing-course" })] }),
    );
    expect(entries).toEqual([]);
  });

  it("skips a dose event whose medication cannot be found", () => {
    const course = makeCourse({ medicationId: "no-such-medication" });
    const entries = buildLogEntries(
      srcOf({ courses: [course], medications: [], doseEvents: [makeDoseEvent()] }),
    );
    expect(entries).toEqual([]);
  });

  it("renders a corrected dose once — the superseded row is not a second entry", () => {
    const original = makeDoseEvent({
      id: "dose-original",
      givenAt: "2026-08-05T07:00:00.000Z",
      loggedAt: "2026-08-05T07:00:00.000Z",
    });
    const correction = makeDoseEvent({
      id: "dose-correction",
      givenAt: "2026-08-05T05:30:00.000Z",
      loggedAt: "2026-08-06T09:00:00.000Z",
      supersedesId: "dose-original",
    });

    const entries = buildLogEntries(
      srcOf({
        courses: [makeCourse()],
        medications: [makeMedication()],
        doseEvents: [original, correction],
      }),
    );

    expect(entries.map((e) => e.id)).toEqual(["dose-correction"]);
    // And the summary strip counts one dose, not two.
    expect(summarise(entries)).toEqual({ given: 1, skipped: 0, missed: 0 });
  });

  // The sweep writes `missed` from one device's local view of the ledger. Two
  // ways that view can be wrong reached History as contradictory rows.
  describe("a `missed` row the ledger contradicts", () => {
    const SLOT = "2026-08-13T05:00:00.000Z";
    const KEY = "course-1|2026-08-13T05:00:00.000Z";

    it("is dropped when the same occurrence carries a live `given` row", () => {
      const given = makeDoseEvent({
        id: "dose-given",
        status: "given",
        scheduledFor: SLOT,
        occurrenceKey: KEY,
        givenAt: "2026-08-13T08:40:48.350Z",
        loggedAt: "2026-08-13T08:40:48.350Z",
      });
      const missed = makeDoseEvent({
        id: "dose-missed",
        status: "missed",
        scheduledFor: SLOT,
        occurrenceKey: KEY,
        givenAt: "2026-08-13T17:22:30.850Z",
        loggedAt: "2026-08-13T17:22:30.850Z",
      });

      const entries = buildLogEntries(
        srcOf({ courses: [makeCourse()], medications: [makeMedication()], doseEvents: [given, missed] }),
      );

      expect(entries.map((e) => e.id)).toEqual(["dose-given"]);
      expect(summarise(entries)).toEqual({ given: 1, skipped: 0, missed: 0 });
    });

    it("is dropped when the same occurrence carries a live `skipped` row", () => {
      const skipped = makeDoseEvent({
        id: "dose-skipped",
        status: "skipped",
        scheduledFor: SLOT,
        occurrenceKey: KEY,
        loggedAt: "2026-08-13T07:00:00.000Z",
      });
      const missed = makeDoseEvent({
        id: "dose-missed",
        status: "missed",
        scheduledFor: SLOT,
        occurrenceKey: KEY,
        loggedAt: "2026-08-13T17:22:30.850Z",
      });

      const entries = buildLogEntries(
        srcOf({ courses: [makeCourse()], medications: [makeMedication()], doseEvents: [skipped, missed] }),
      );

      expect(entries.map((e) => e.id)).toEqual(["dose-skipped"]);
    });

    it("collapses two devices' `missed` rows for one slot to the earliest", () => {
      const first = makeDoseEvent({
        id: "dose-missed-a",
        status: "missed",
        scheduledFor: SLOT,
        occurrenceKey: KEY,
        loggedAt: "2026-08-13T21:00:23.863Z",
      });
      const second = makeDoseEvent({
        id: "dose-missed-b",
        status: "missed",
        scheduledFor: SLOT,
        occurrenceKey: KEY,
        loggedAt: "2026-08-13T22:17:40.818Z",
      });

      const entries = buildLogEntries(
        srcOf({ courses: [makeCourse()], medications: [makeMedication()], doseEvents: [second, first] }),
      );

      expect(entries.map((e) => e.id)).toEqual(["dose-missed-a"]);
      expect(summarise(entries)).toEqual({ given: 0, skipped: 0, missed: 1 });
    });

    it("still shows a lone `missed` row, and a `missed` CORRECTION of a given dose", () => {
      const lone = makeDoseEvent({
        id: "dose-missed",
        status: "missed",
        scheduledFor: SLOT,
        occurrenceKey: KEY,
        loggedAt: "2026-08-13T17:22:30.850Z",
      });
      expect(
        buildLogEntries(
          srcOf({ courses: [makeCourse()], medications: [makeMedication()], doseEvents: [lone] }),
        ).map((e) => e.id),
      ).toEqual(["dose-missed"]);

      // "It was not actually given" — a deliberate statement about that row,
      // not a stale sweep guess, so the resolving row it supersedes is gone
      // and the correction stands.
      const given = makeDoseEvent({
        id: "dose-given",
        status: "given",
        scheduledFor: SLOT,
        occurrenceKey: KEY,
        loggedAt: "2026-08-13T08:00:00.000Z",
      });
      const correction = makeDoseEvent({
        id: "dose-correction",
        status: "missed",
        scheduledFor: SLOT,
        occurrenceKey: KEY,
        loggedAt: "2026-08-13T09:00:00.000Z",
        supersedesId: "dose-given",
      });
      expect(
        buildLogEntries(
          srcOf({
            courses: [makeCourse()],
            medications: [makeMedication()],
            doseEvents: [given, correction],
          }),
        ).map((e) => e.id),
      ).toEqual(["dose-correction"]);
    });
  });

  it("says on the row that the time was edited, and what it used to be", () => {
    const original = makeDoseEvent({ id: "dose-original", givenAt: "2026-08-05T07:00:00.000Z" });
    const correction = makeDoseEvent({
      id: "dose-correction",
      givenAt: "2026-08-05T05:30:00.000Z",
      supersedesId: "dose-original",
    });

    const [entry] = buildLogEntries(
      srcOf({
        courses: [makeCourse()],
        medications: [makeMedication()],
        doseEvents: [original, correction],
      }),
    );

    const was = new Date(original.givenAt);
    const hh = String(was.getHours()).padStart(2, "0");
    const mm = String(was.getMinutes()).padStart(2, "0");
    expect(detailOf(entry)).toContain(`time edited from ${hh}:${mm}`);
  });

  it("does not claim a time edit when the correction changed something else", () => {
    const original = makeDoseEvent({ id: "dose-original", givenAt: "2026-08-05T07:00:00.000Z" });
    const correction = makeDoseEvent({
      id: "dose-correction",
      givenAt: "2026-08-05T07:00:00.000Z",
      amount: 0.6,
      supersedesId: "dose-original",
    });

    const [entry] = buildLogEntries(
      srcOf({
        courses: [makeCourse()],
        medications: [makeMedication()],
        doseEvents: [original, correction],
      }),
    );

    expect(detailOf(entry)).not.toContain("time edited");
  });

  it("drops a soft-deleted dose event", () => {
    const entries = buildLogEntries(
      srcOf({
        courses: [makeCourse()],
        medications: [makeMedication()],
        doseEvents: [makeDoseEvent({ deletedAt: "2026-08-06T09:00:00.000Z" })],
      }),
    );
    expect(entries).toEqual([]);
  });

  it("offers Edit time on given doses only", () => {
    const entries = buildLogEntries(
      srcOf({
        courses: [makeCourse()],
        medications: [makeMedication()],
        doseEvents: [
          makeDoseEvent({ id: "given" }),
          makeDoseEvent({ id: "skipped", status: "skipped" }),
          makeDoseEvent({ id: "missed", status: "missed" }),
        ],
        courseEvents: [makeCourseEvent()],
      }),
    );

    expect(
      Object.fromEntries(entries.map((e) => [e.id, e.canEditTime])),
    ).toEqual({ given: true, skipped: false, missed: false, "cev-1": false });
  });

  it("carries the course id on every entry", () => {
    const entries = buildLogEntries(
      srcOf({
        courses: [makeCourse()],
        medications: [makeMedication()],
        doseEvents: [makeDoseEvent()],
        courseEvents: [makeCourseEvent()],
      }),
    );
    expect(entries.every((e) => e.courseId === "course-1")).toBe(true);
  });

  it("orders dose and course entries newest-first, interleaved", () => {
    const course = makeCourse();
    const medication = makeMedication();
    const doseEarly = makeDoseEvent({
      id: "dose-early",
      scheduledFor: "2026-08-05T07:00:00.000Z",
      givenAt: "2026-08-05T07:00:00.000Z",
    });
    const doseLate = makeDoseEvent({
      id: "dose-late",
      scheduledFor: "2026-08-09T07:00:00.000Z",
      givenAt: "2026-08-09T07:00:00.000Z",
    });
    const courseEvMid = makeCourseEvent({ id: "cev-mid", at: "2026-08-07T09:00:00.000Z" });

    const entries = buildLogEntries(
      srcOf({
        courses: [course],
        medications: [medication],
        doseEvents: [doseEarly, doseLate],
        courseEvents: [courseEvMid],
      }),
    );

    expect(entries.map((e) => e.id)).toEqual(["dose-late", "cev-mid", "dose-early"]);
  });

  describe("within-day ordering: sorts by the displayed time, not the scheduling instant", () => {
    it("a dose given late sorts by its givenAt, not its scheduledFor", () => {
      const course = makeCourse();
      const medication = makeMedication();
      // Dose A: scheduled 08:00, given 19:10 — displays "19:10".
      // Sorting by `at` (== scheduledFor here, since both are `given`) would
      // put B (scheduled 19:00) ahead of A (scheduled 08:00) — the wrong,
      // pre-fix order. Sorting by `displayAt` (== givenAt) correctly puts A
      // (given 19:10) ahead of B (given 19:09).
      const doseA = makeDoseEvent({
        id: "dose-a",
        scheduledFor: "2026-08-01T07:00:00.000Z", // 08:00 BST
        givenAt: "2026-08-01T18:10:00.000Z", // 19:10 BST
      });
      // Dose B: scheduled 19:00, given 19:09 — displays "19:09".
      const doseB = makeDoseEvent({
        id: "dose-b",
        scheduledFor: "2026-08-01T18:00:00.000Z", // 19:00 BST
        givenAt: "2026-08-01T18:09:00.000Z", // 19:09 BST
      });

      const entries = buildLogEntries(
        srcOf({ courses: [course], medications: [medication], doseEvents: [doseA, doseB] }),
      );

      expect(entries.map((e) => e.id)).toEqual(["dose-a", "dose-b"]);
      expect(entries.map((e) => e.time)).toEqual(["19:10", "19:09"]);
    });

    it("a course lifecycle event interleaves with doses on the same day by its displayed time", () => {
      const course = makeCourse();
      const medication = makeMedication();
      const doseMorning = makeDoseEvent({
        id: "dose-morning",
        scheduledFor: "2026-08-01T07:00:00.000Z", // 08:00 BST
        givenAt: "2026-08-01T07:00:00.000Z", // 08:00 BST
      });
      const coursePaused = makeCourseEvent({
        id: "cev-paused",
        kind: "paused",
        at: "2026-08-01T11:00:00.000Z", // 12:00 BST — between the two doses
      });
      const doseEvening = makeDoseEvent({
        id: "dose-evening",
        scheduledFor: "2026-08-01T18:00:00.000Z", // 19:00 BST
        givenAt: "2026-08-01T18:00:00.000Z", // 19:00 BST
      });

      const entries = buildLogEntries(
        srcOf({
          courses: [course],
          medications: [medication],
          doseEvents: [doseMorning, doseEvening],
          courseEvents: [coursePaused],
        }),
      );

      expect(entries.map((e) => e.id)).toEqual(["dose-evening", "cev-paused", "dose-morning"]);
    });
  });

  describe("§3d day boundary: a 23:00-scheduled dose logged at 00:20", () => {
    it("groups to the day it was scheduled for, not the day it was logged", () => {
      const course = makeCourse({ schedule: { kind: "fixedTimes", times: ["23:00"] } });
      const medication = makeMedication();
      // 23:00 BST on 8 Aug = 22:00 UTC. Logged 00:20 BST on 9 Aug = 23:20 UTC.
      const dose = makeDoseEvent({
        scheduledFor: "2026-08-08T22:00:00.000Z",
        givenAt: "2026-08-08T23:20:00.000Z",
      });

      const entries = buildLogEntries(
        srcOf({ courses: [course], medications: [medication], doseEvents: [dose] }),
      );
      expect(entries).toHaveLength(1);
      const [entry] = entries;

      // Displayed time is when it was actually logged...
      expect(entry.time).toBe("00:20");
      // ...but the day-grouping instant is the scheduled one.
      const groups = groupByDay(entries, "2026-08-09");
      expect(groups).toHaveLength(1);
      expect(groups[0].key).toBe("2026-08-08");
      expect(groups[0].heading).toEqual({ relative: "yesterday", day: "2026-08-08" });
      expect(renderDayHeading(groups[0].heading, en)).toBe("Yesterday · Sat 8 Aug");
    });
  });

  describe("dose detail lines", () => {
    it('given exactly on time with no other clauses -> "Given"', () => {
      const course = makeCourse();
      const medication = makeMedication();
      const dose = makeDoseEvent({
        scheduledFor: "2026-08-01T07:00:00.000Z",
        givenAt: "2026-08-01T07:00:00.000Z",
      });
      const [entry] = buildLogEntries(
        srcOf({ courses: [course], medications: [medication], doseEvents: [dose] }),
      );
      expect(detailOf(entry)).toBe("Given");
    });

    // SPEC §3b-i: a "Give anyway" dose past the daily cap reads "over the
    // daily maximum" right after the given headline.
    it('given, flagged overMax -> "Given · over the daily maximum"', () => {
      const course = makeCourse();
      const medication = makeMedication();
      const dose = makeDoseEvent({
        scheduledFor: "2026-08-01T07:00:00.000Z",
        givenAt: "2026-08-01T07:00:00.000Z",
        overMax: true,
      });
      const [entry] = buildLogEntries(
        srcOf({ courses: [course], medications: [medication], doseEvents: [dose] }),
      );
      expect(detailOf(entry)).toBe("Given · over the daily maximum");
    });

    it("no overMax clause when the flag is absent, and none for a skipped dose even if overMax were somehow true", () => {
      const course = makeCourse();
      const medication = makeMedication();
      const plainGiven = makeDoseEvent({
        scheduledFor: "2026-08-01T07:00:00.000Z",
        givenAt: "2026-08-01T07:00:00.000Z",
      });
      const skippedOverMax = makeDoseEvent({
        id: "dose-2",
        status: "skipped",
        scheduledFor: "2026-08-01T07:00:00.000Z",
        givenAt: "2026-08-01T07:00:00.000Z",
        overMax: true,
      });
      const entries = buildLogEntries(
        srcOf({ courses: [course], medications: [medication], doseEvents: [plainGiven, skippedOverMax] }),
      );
      const plainEntry = entries.find((e) => e.id === "dose-1")!;
      const skippedEntry = entries.find((e) => e.id === "dose-2")!;
      expect(detailOf(plainEntry)).toBe("Given");
      expect(detailOf(skippedEntry)).toBe("Skipped");
    });

    it('SPEC §6.4 example: "Given 40 min late · chain shifted"', () => {
      const course = makeCourse({ schedule: { kind: "fromLastDose", intervalHours: 8 } });
      const medication = makeMedication();
      const dose = makeDoseEvent({
        scheduledFor: "2026-08-01T07:00:00.000Z",
        givenAt: "2026-08-01T07:40:00.000Z",
      });
      const [entry] = buildLogEntries(
        srcOf({ courses: [course], medications: [medication], doseEvents: [dose] }),
      );
      expect(detailOf(entry)).toBe("Given 40 min late · chain shifted");
    });

    it("late by more than an hour combines hours and minutes", () => {
      const course = makeCourse();
      const medication = makeMedication();
      const dose = makeDoseEvent({
        scheduledFor: "2026-08-01T07:00:00.000Z",
        givenAt: "2026-08-01T08:20:00.000Z",
      });
      const [entry] = buildLogEntries(
        srcOf({ courses: [course], medications: [medication], doseEvents: [dose] }),
      );
      expect(detailOf(entry).startsWith("Given 1 h 20 min late")).toBe(true);
    });

    it('SPEC §6.4 example: "Skipped · refused syringe"', () => {
      const course = makeCourse();
      const medication = makeMedication();
      const dose = makeDoseEvent({ status: "skipped", note: "refused syringe" });
      const [entry] = buildLogEntries(
        srcOf({ courses: [course], medications: [medication], doseEvents: [dose] }),
      );
      expect(detailOf(entry)).toBe("Skipped · refused syringe");
      expect(entry.status).toBe("skipped");
    });

    it('SPEC §6.4 example: "Missed · scheduled 08:00"', () => {
      const course = makeCourse();
      const medication = makeMedication();
      const dose = makeDoseEvent({
        status: "missed",
        scheduledFor: "2026-08-01T07:00:00.000Z", // 08:00 BST
        givenAt: "2026-08-01T19:00:00.000Z",
      });
      const [entry] = buildLogEntries(
        srcOf({ courses: [course], medications: [medication], doseEvents: [dose] }),
      );
      expect(detailOf(entry)).toBe("Missed · scheduled 08:00");
    });

    it("appends instructions and note, in order, after the head clause", () => {
      const course = makeCourse({ instructions: "after food" });
      const medication = makeMedication();
      const dose = makeDoseEvent({
        status: "skipped",
        note: "vomited",
        scheduledFor: "2026-08-01T07:00:00.000Z",
      });
      const [entry] = buildLogEntries(
        srcOf({ courses: [course], medications: [medication], doseEvents: [dose] }),
      );
      expect(detailOf(entry)).toBe("Skipped · after food · vomited");
    });

    it("given, fromLastDose, not late -> next due clause via engine's nextDueAt", () => {
      const course = makeCourse({
        schedule: { kind: "fromLastDose", intervalHours: 8 },
        startDate: "2026-08-01",
        endDate: null,
        status: "active",
      });
      const medication = makeMedication();
      const dose = makeDoseEvent({
        scheduledFor: null,
        givenAt: "2026-08-08T06:00:00.000Z", // 07:00 BST
      });
      const [entry] = buildLogEntries(
        srcOf({ courses: [course], medications: [medication], doseEvents: [dose] }),
      );
      // 07:00 BST + 8h = 15:00 BST.
      expect(detailOf(entry)).toBe("Given · next due 15:00, every 8h · from last dose");
    });

    it("given, fixedTimes, course has an endDate -> course progress clause", () => {
      const course = makeCourse({
        schedule: { kind: "fixedTimes", times: ["08:00"] },
        startDate: "2026-08-01",
        endDate: "2026-08-07",
      });
      const medication = makeMedication();
      const dose = makeDoseEvent({
        scheduledFor: "2026-08-03T07:00:00.000Z",
        givenAt: "2026-08-03T07:00:00.000Z",
      });
      const [entry] = buildLogEntries(
        srcOf({ courses: [course], medications: [medication], doseEvents: [dose] }),
      );
      expect(detailOf(entry)).toBe("Given · day 3 of 7");
    });

    it("uses the dose event's own amount snapshot for the title, not the course's current dose", () => {
      const course = makeCourse({ doseAmount: 0.6 }); // course has since been edited
      const medication = makeMedication({ name: "Metacam" });
      const dose = makeDoseEvent({ amount: 0.4 });
      const [entry] = buildLogEntries(
        srcOf({ courses: [course], medications: [medication], doseEvents: [dose] }),
      );
      // Structure, not prose — the wording ("Metacam 0.4 ml") is
      // `i18n/history.ts#renderLogTitle`'s, and is pinned there.
      expect(entry.title).toEqual({ medicationName: "Metacam", amount: 0.4, unit: "ml" });
    });
  });

  describe("course event detail lines", () => {
    it('paused -> "Course paused"', () => {
      const course = makeCourse();
      const medication = makeMedication();
      const ce = makeCourseEvent({ kind: "paused" });
      const [entry] = buildLogEntries(
        srcOf({ courses: [course], medications: [medication], courseEvents: [ce] }),
      );
      expect(detailOf(entry)).toBe("Course paused");
      expect(entry.status).toBe("course");
      expect(entry.kind).toBe("course");
    });

    it('started -> "Course started" with describeSchedule and total days', () => {
      const course = makeCourse();
      const medication = makeMedication();
      const after: CourseSnapshot = {
        schedule: { kind: "fixedTimes", times: ["08:00", "20:00"] },
        doseAmount: 0.4,
        doseUnit: "ml",
        startDate: "2026-08-01",
        endDate: "2026-08-07",
      };
      const ce = makeCourseEvent({ kind: "started", before: null, after });
      const [entry] = buildLogEntries(
        srcOf({ courses: [course], medications: [medication], courseEvents: [ce] }),
      );
      expect(detailOf(entry)).toBe("Course started · 2× daily · 08:00, 20:00 · for 7 days");
    });

    it('edited with a schedule change -> "Interval changed · … to …"', () => {
      const course = makeCourse();
      const medication = makeMedication();
      const before: CourseSnapshot = {
        schedule: { kind: "fromLastDose", intervalHours: 12 },
        doseAmount: 0.4,
        doseUnit: "ml",
        startDate: "2026-08-01",
        endDate: null,
      };
      const after: CourseSnapshot = {
        schedule: { kind: "fixedTimes", times: ["08:00", "20:00"] },
        doseAmount: 0.4,
        doseUnit: "ml",
        startDate: "2026-08-01",
        endDate: null,
      };
      const ce = makeCourseEvent({ kind: "edited", before, after });
      const [entry] = buildLogEntries(
        srcOf({ courses: [course], medications: [medication], courseEvents: [ce] }),
      );
      expect(detailOf(entry)).toBe(
        "Interval changed · every 12h · from last dose to 2× daily · 08:00, 20:00",
      );
    });

    it('edited with a dose change -> "Dose changed · … to …"', () => {
      const course = makeCourse();
      const medication = makeMedication();
      const before: CourseSnapshot = { ...defaultSnapshot, doseAmount: 0.4, doseUnit: "ml" };
      const after: CourseSnapshot = { ...defaultSnapshot, doseAmount: 0.6, doseUnit: "ml" };
      const ce = makeCourseEvent({ kind: "edited", before, after });
      const [entry] = buildLogEntries(
        srcOf({ courses: [course], medications: [medication], courseEvents: [ce] }),
      );
      expect(detailOf(entry)).toBe("Dose changed · 0.4 ml to 0.6 ml");
    });

    it('edited with before === null falls back to "Course edited"', () => {
      const course = makeCourse();
      const medication = makeMedication();
      const ce = makeCourseEvent({ kind: "edited", before: null });
      const [entry] = buildLogEntries(
        srcOf({ courses: [course], medications: [medication], courseEvents: [ce] }),
      );
      expect(detailOf(entry)).toBe("Course edited");
    });
  });
});

describe("detail lines are structure, not prose (I18N-DESIGN.md §6)", () => {
  it("emits a clause list, with lateness split into hours and minutes", () => {
    const course = makeCourse({ schedule: { kind: "fromLastDose", intervalHours: 8 } });
    const medication = makeMedication();
    const dose = makeDoseEvent({
      scheduledFor: "2026-08-01T07:00:00.000Z",
      givenAt: "2026-08-01T07:40:00.000Z",
    });
    const [entry] = buildLogEntries(
      srcOf({ courses: [course], medications: [medication], doseEvents: [dose] }),
    );
    expect(entry.detail).toEqual([
      { kind: "givenLate", hours: 0, minutes: 40 },
      { kind: "chainShifted" },
    ]);
  });

  it("carries instructions and the user's note verbatim, as data", () => {
    const course = makeCourse({ instructions: "after food" });
    const medication = makeMedication();
    const dose = makeDoseEvent({ status: "skipped", note: "Курс: відмовився" });
    const [entry] = buildLogEntries(
      srcOf({ courses: [course], medications: [medication], doseEvents: [dose] }),
    );
    expect(entry.detail).toEqual([
      { kind: "skipped" },
      { kind: "text", text: "after food" },
      { kind: "text", text: "Курс: відмовився" },
    ]);
    // Untranslated in either language — it is the user's own text.
    expect(renderDetail(entry.detail, createTranslator("uk"))).toContain("Курс: відмовився");
  });

  it("carries the engine's schedule description, not a rendering of it", () => {
    const course = makeCourse();
    const medication = makeMedication();
    const after: CourseSnapshot = {
      schedule: { kind: "fixedTimes", times: ["08:00", "20:00"] },
      doseAmount: 0.4,
      doseUnit: "ml",
      startDate: "2026-08-01",
      endDate: "2026-08-07",
    };
    const ce = makeCourseEvent({ kind: "started", before: null, after });
    const [entry] = buildLogEntries(
      srcOf({ courses: [course], medications: [medication], courseEvents: [ce] }),
    );
    expect(entry.detail).toEqual([
      {
        kind: "courseStarted",
        schedule: {
          segments: [
            { kind: "timesPerDay", times: 2 },
            { kind: "times", times: ["08:00", "20:00"] },
          ],
        },
        totalDays: 7,
      },
    ]);
  });

  it("renders the whole screen's detail lines in Ukrainian from the same structure", () => {
    const uk = createTranslator("uk");
    const course = makeCourse({ schedule: { kind: "fromLastDose", intervalHours: 8 } });
    const medication = makeMedication();
    const dose = makeDoseEvent({
      scheduledFor: "2026-08-01T07:00:00.000Z",
      givenAt: "2026-08-01T07:40:00.000Z",
    });
    const [entry] = buildLogEntries(
      srcOf({ courses: [course], medications: [medication], doseEvents: [dose] }),
    );
    expect(renderDetail(entry.detail, uk)).toBe(
      "Дано із запізненням на 40 хв · ланцюжок зсунуто",
    );
  });
});

describe("filterEntries", () => {
  const course = makeCourse();
  const medication = makeMedication();
  const entries = buildLogEntries(
    srcOf({
      courses: [course],
      medications: [medication],
      doseEvents: [makeDoseEvent({ id: "dose-1" })],
      courseEvents: [makeCourseEvent({ id: "cev-1" })],
    }),
  );

  it('"doses" narrows to dose-kind entries only', () => {
    expect(filterEntries(entries, "doses").map((e) => e.id)).toEqual(["dose-1"]);
  });

  it('"courses" narrows to course-kind entries only', () => {
    expect(filterEntries(entries, "courses").map((e) => e.id)).toEqual(["cev-1"]);
  });

  it('"all" restores every entry', () => {
    const filtered = filterEntries(entries, "doses");
    expect(filtered).not.toEqual(entries);
    expect(filterEntries(entries, "all")).toEqual(entries);
  });
});

describe("dayHeading", () => {
  it("daysAgo 0 -> today, rendered 'Today · <date>'", () => {
    expect(dayHeading("2026-08-09", "2026-08-09")).toEqual({
      relative: "today",
      day: "2026-08-09",
    });
    expect(renderDayHeading(dayHeading("2026-08-09", "2026-08-09"), en)).toBe("Today · Sun 9 Aug");
  });

  it("daysAgo 1 -> yesterday, rendered 'Yesterday · <date>'", () => {
    expect(dayHeading("2026-08-08", "2026-08-09")).toEqual({
      relative: "yesterday",
      day: "2026-08-08",
    });
    expect(renderDayHeading(dayHeading("2026-08-08", "2026-08-09"), en)).toBe(
      "Yesterday · Sat 8 Aug",
    );
  });

  it("otherwise -> no relative part, bare date with no leading zero on the day", () => {
    expect(dayHeading("2026-08-07", "2026-08-09")).toEqual({ relative: null, day: "2026-08-07" });
    expect(renderDayHeading(dayHeading("2026-08-07", "2026-08-09"), en)).toBe("Fri 7 Aug");
  });
});

describe("groupByDay", () => {
  it("groups newest day first, preserving each day's entry order", () => {
    const course = makeCourse();
    const medication = makeMedication();
    const entries = buildLogEntries(
      srcOf({
        courses: [course],
        medications: [medication],
        doseEvents: [
          makeDoseEvent({
            id: "d1",
            scheduledFor: "2026-08-07T07:00:00.000Z",
            givenAt: "2026-08-07T07:00:00.000Z",
          }),
          makeDoseEvent({
            id: "d2",
            scheduledFor: "2026-08-09T07:00:00.000Z",
            givenAt: "2026-08-09T07:00:00.000Z",
          }),
        ],
      }),
    );
    const groups = groupByDay(entries, "2026-08-09");
    expect(groups.map((g) => g.key)).toEqual(["2026-08-09", "2026-08-07"]);
    expect(groups[0].entries.map((e) => e.id)).toEqual(["d2"]);
    expect(groups[1].entries.map((e) => e.id)).toEqual(["d1"]);
  });
});

describe("summarise", () => {
  it("counts given/skipped/missed and ignores course entries, over whatever is passed in", () => {
    const course = makeCourse();
    const medication = makeMedication();
    const entries = buildLogEntries(
      srcOf({
        courses: [course],
        medications: [medication],
        doseEvents: [
          makeDoseEvent({ id: "d1", status: "given" }),
          makeDoseEvent({ id: "d2", status: "given" }),
          makeDoseEvent({ id: "d3", status: "skipped" }),
          makeDoseEvent({ id: "d4", status: "missed" }),
        ],
        courseEvents: [makeCourseEvent({ id: "cev-1" })],
      }),
    );
    expect(summarise(entries)).toEqual({ given: 2, skipped: 1, missed: 1 });

    // Independent of the active filter: summarising a filtered-down view
    // counts only what it's given, by design (the caller must pass the
    // unfiltered range for the screen's summary strip).
    expect(summarise(filterEntries(entries, "courses"))).toEqual({
      given: 0,
      skipped: 0,
      missed: 0,
    });
  });
});

describe("unknown actor", () => {
  it("carries the raw actorId through untouched — resolving to a display name is not this module's job", () => {
    const course = makeCourse();
    const medication = makeMedication();
    const dose = makeDoseEvent({ actorId: "ghost-user-id" });
    const [entry] = buildLogEntries(
      srcOf({ courses: [course], medications: [medication], doseEvents: [dose] }),
    );
    expect(entry.actorId).toBe("ghost-user-id");
  });
});
