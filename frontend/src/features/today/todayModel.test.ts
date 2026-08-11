import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Course, DoseEvent, LocalTime } from "@/domain";
import {
  addLocalDays,
  atLocalTime,
  cloneFixtures,
  FIXTURE_NOW,
  formatHHMM,
  localDayKey,
  occurrenceKeyFor,
} from "@/domain";
import type { Occurrence } from "@/engine";
import type { TodayPetGroup, TodaySnapshot, TodayView } from "./types";

// The engine's occurrence/dose-state functions are still W2's stubs on this
// branch, so drive them from a lookup table instead. `actual` keeps the real
// `describeSchedule`/`courseProgress`, which are already implemented and whose
// output this screen renders verbatim.
vi.mock("@/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/engine")>();
  const { engineDouble } = await import("./testEngine");
  return { ...actual, ...engineDouble };
});

import {
  engineDouble,
  engineStore,
  makeOccurrence,
  resetEngineStore,
  setOccurrences,
  setState,
} from "./testEngine";
import { createTranslator } from "@/i18n";
import { buildTodayView, greetingFor, scheduledForOf } from "./todayModel";

// Every literal asserted below is English, so the model is driven with the
// English translator explicitly (I18N-DESIGN.md §5: these are pure functions
// that take an injected translator). The assertions therefore keep meaning
// exactly what they meant before localization — they pin the English
// rendering of the catalogue entries against the pre-i18n strings.
const EN = createTranslator("en");

const NOW = new Date(FIXTURE_NOW);
const DAY = localDayKey(NOW);

const COURSE_CLOVER_METACAM = "c0000000-0000-4000-8000-000000000001";
const COURSE_CLOVER_METOCLOPRAMIDE = "c0000000-0000-4000-8000-000000000002";
const COURSE_NUGGET_VITAMIN_C = "c0000000-0000-4000-8000-000000000003";
const COURSE_NUGGET_IVERMECTIN = "c0000000-0000-4000-8000-000000000005";
const COURSE_BISCUIT_IVERMECTIN = "c0000000-0000-4000-8000-000000000006";
const COURSE_BISCUIT_METOCLOPRAMIDE = "c0000000-0000-4000-8000-000000000007";

const data = cloneFixtures();

function courseOf(id: string): Course {
  const course = data.courses.find((c) => c.id === id);
  if (!course) throw new Error(`no fixture course ${id}`);
  return course;
}

function eventFor(occurrenceKey: string): DoseEvent | null {
  return data.doseEvents.find((e) => e.occurrenceKey === occurrenceKey) ?? null;
}

/** An occurrence of `courseId` due at `time` local on the snapshot day. */
function occAt(courseId: string, time: LocalTime): Occurrence {
  const course = courseOf(courseId);
  const scheduledFor = atLocalTime(DAY, time).toISOString();
  return makeOccurrence(course, {
    day: DAY,
    scheduledFor,
    event: eventFor(`${courseId}|${scheduledFor}`),
  });
}

/** A `fromLastDose` occurrence that has never been given: no due time at all. */
function occNotStarted(courseId: string): Occurrence {
  return makeOccurrence(courseOf(courseId), { day: DAY, scheduledFor: null });
}

function snapshotOf(
  occurrences: Occurrence[],
  overrides: Partial<TodaySnapshot> = {},
): TodaySnapshot {
  return {
    day: DAY,
    pets: data.pets,
    medications: data.medications,
    courses: data.courses,
    events: data.doseEvents,
    // `engineDouble` (this file's `vi.mock("@/engine")`) never reads
    // `courseEvents` — its `getOccurrences`/`nextDueAt` are lookup-table
    // stubs driven by `setOccurrences`/`engineStore.nextDue` — so an empty
    // ledger here is a real, not a defaulted, value: there is no ledger for
    // this test double to consult.
    courseEvents: [],
    occurrences,
    ...overrides,
  };
}

function groupNamed(view: TodayView, name: string): TodayPetGroup {
  const group = view.groups.find((g) => g.pet.name === name);
  if (!group) throw new Error(`no group for ${name}`);
  return group;
}

beforeEach(() => {
  resetEngineStore();
});

describe("greetingFor", () => {
  it("cuts at 12:00 and 18:00 local", () => {
    expect(greetingFor(new Date(2026, 7, 8, 11, 59), EN)).toBe("Good morning");
    expect(greetingFor(new Date(2026, 7, 8, 12, 0), EN)).toBe("Good afternoon");
    expect(greetingFor(new Date(2026, 7, 8, 17, 59), EN)).toBe("Good afternoon");
    expect(greetingFor(new Date(2026, 7, 8, 18, 0), EN)).toBe("Good evening");
  });
});

describe("buildTodayView — dose fields", () => {
  it("titles a dose from the medication and the occurrence's amount", () => {
    const occ = occAt(COURSE_CLOVER_METACAM, "08:00");
    setState(occ.key, "later");

    const dose = groupNamed(buildTodayView(snapshotOf([occ]), NOW, EN), "Clover")
      .pending[0];

    expect(dose.title).toBe("Metacam 0.4 ml");
    expect(dose.medicationName).toBe("Metacam");
    expect(dose.time).toBe("08:00");
    // Anchored on the parts SPEC §5.1 requires — scheduled time, then
    // instructions, then course progress — and deliberately NOT on the exact
    // wording or casing of `courseProgress`, which is the engine's to choose
    // and differs between W0's stub ("Day 3 of 7") and W2's real
    // implementation ("day 3 of 7"). Pinning the literal would pass here and
    // fail the moment the real engine merges.
    expect(dose.detail.startsWith("08:00 · after food · ")).toBe(true);
    expect(dose.detail).toMatch(/day 3 of 7/i);
    expect(dose.key).toBe(occ.key);
    expect(dose.courseId).toBe(COURSE_CLOVER_METACAM);
  });

  it("reports the LOGGED time on a resolved dose, not the scheduled one", () => {
    // Due 07:00, given 07:12 — the DoseRow renders this in place of Give.
    const given = occAt(COURSE_BISCUIT_IVERMECTIN, "07:00");
    setState(given.key, "given");

    const dose = groupNamed(buildTodayView(snapshotOf([given]), NOW, EN), "Biscuit")
      .resolved[0];

    expect(dose.occurrence.dueAt && formatHHMM(dose.occurrence.dueAt)).toBe(
      "07:00",
    );
    expect(dose.time).toBe("07:12");
    expect(dose.detail.startsWith("07:12")).toBe(true);
  });

  it("falls back to the scheduled time when a resolved dose has no event", () => {
    const given = occAt(COURSE_CLOVER_METACAM, "20:00");
    setState(given.key, "given");

    const dose = groupNamed(buildTodayView(snapshotOf([given]), NOW, EN), "Clover")
      .resolved[0];

    expect(dose.occurrence.event).toBeNull();
    expect(dose.time).toBe("20:00");
  });

  it("renders a notStarted interval dose with no time and the 'from last dose' phrase", () => {
    const occ = occNotStarted(COURSE_BISCUIT_METOCLOPRAMIDE);
    setState(occ.key, "notStarted");

    const dose = groupNamed(buildTodayView(snapshotOf([occ]), NOW, EN), "Biscuit")
      .pending[0];

    expect(dose.time).toBeNull();
    expect(dose.detail.startsWith("Not started")).toBe(true);
    expect(dose.detail).toContain("from last dose");
  });
});

describe("buildTodayView — fromLastDose reachable before its dueAt (SPEC §3b)", () => {
  it("shows an anchored interval dose whose due instant crosses into tomorrow, giveable early today", () => {
    const course = courseOf(COURSE_CLOVER_METOCLOPRAMIDE);
    const tomorrow = addLocalDays(DAY, 1);
    const scheduledFor = atLocalTime(tomorrow, "02:00").toISOString();
    const occ = makeOccurrence(course, { day: DAY, scheduledFor });
    setState(occ.key, "upcoming");

    const group = groupNamed(buildTodayView(snapshotOf([occ]), NOW, EN), "Clover");
    const dose = group.pending.find((d) => d.key === occ.key);

    expect(dose).toBeDefined();
    expect(dose!.time).toBe("02:00");
    // Reads as due tomorrow rather than "at 02:00" today (requirement: the
    // row must not present an early-reachable dose as if it were due now).
    expect(dose!.detail.startsWith("02:00 · tomorrow · ")).toBe(true);
    expect(dose!.detail).toContain("from last dose");
  });

  it("CRITICAL SCOPE GUARD: an 'upcoming' fixedTimes occurrence is never folded into the pending list", () => {
    // A real fixedTimes occurrence can never actually reach `upcoming` when
    // `day` is the real "today" `TodayPage` always queries (its `dueAt` is
    // always built inside that same day — see `fixedTimesOccurrences`), so
    // this proves the `occ.kind` guard in `isPendingDose` itself rather than
    // just the engine invariant that normally makes it moot: a regression
    // that dropped the guard would flood the dashboard with every later
    // fixed-time dose of the day, which this test would catch.
    const occ = occAt(COURSE_CLOVER_METACAM, "08:00");
    setState(occ.key, "upcoming");

    const group = groupNamed(buildTodayView(snapshotOf([occ]), NOW, EN), "Clover");

    expect(group.pending).toHaveLength(0);
    expect(group.body).toHaveLength(0);
  });
});

describe("buildTodayView — grouping and ordering", () => {
  it("orders overdue pets, then pending pets, then done pets", () => {
    const overdue = occAt(COURSE_CLOVER_METACAM, "08:00");
    const later = occAt(COURSE_NUGGET_VITAMIN_C, "09:00");
    // Biscuit's Ivermectin carries today's `given` DoseEvent from the fixtures.
    const given = occAt(COURSE_BISCUIT_IVERMECTIN, "07:00");
    setState(overdue.key, "overdue");
    setState(later.key, "later");
    setState(given.key, "given");

    const view = buildTodayView(snapshotOf([overdue, later, given]), NOW, EN);

    expect(view.groups.map((g) => g.pet.name)).toEqual([
      "Clover",
      "Nugget",
      "Biscuit",
    ]);
    expect(groupNamed(view, "Clover").status).toBe("Overdue since 08:00");
    expect(groupNamed(view, "Clover").hasOverdue).toBe(true);
    expect(groupNamed(view, "Nugget").status).toBe("Next at 09:00");
    const done = groupNamed(view, "Biscuit");
    expect(done.done).toBe(true);
    expect(done.resolved).toHaveLength(1);
    // SPEC §4: a given dose presents with the time LOGGED. The fixture's
    // Ivermectin was due at 07:00 and given at 07:12.
    expect(done.status).toBe("All done · Ivermectin at 07:12");
  });

  it("gives a pet with no occurrences an empty group", () => {
    const view = buildTodayView(snapshotOf([]), NOW, EN);

    expect(view.groups).toHaveLength(3);
    const clover = groupNamed(view, "Clover");
    expect(clover.pending).toEqual([]);
    expect(clover.counterLabel).toBe("");
    expect(clover.status).toBe("Nothing scheduled");
    expect(clover.done).toBe(true);
  });

  it("sorts pending doses by due time with notStarted last", () => {
    const evening = occAt(COURSE_CLOVER_METACAM, "20:00");
    const morning = occAt(COURSE_CLOVER_METACAM, "08:00");
    const none = occNotStarted(COURSE_CLOVER_METOCLOPRAMIDE);
    setState(none.key, "notStarted");

    const group = groupNamed(
      buildTodayView(snapshotOf([none, evening, morning]), NOW, EN),
      "Clover",
    );

    expect(group.pending.map((d) => d.time)).toEqual(["08:00", "20:00", null]);
    expect(group.nextDueAt?.getTime()).toBe(morning.dueAt?.getTime());
  });
});

describe("buildTodayView — subtitle", () => {
  it("appends the overdue clause only when there is an overdue dose", () => {
    const overdue = occAt(COURSE_CLOVER_METACAM, "08:00");
    const later = occAt(COURSE_NUGGET_VITAMIN_C, "09:00");
    setState(overdue.key, "overdue");
    setState(later.key, "later");

    expect(buildTodayView(snapshotOf([overdue, later]), NOW, EN).subtitle).toBe(
      "2 doses left today · 1 overdue",
    );

    setState(overdue.key, "later");
    const clear = buildTodayView(snapshotOf([overdue, later]), NOW, EN);
    expect(clear.subtitle).toBe("2 doses left today");
    expect(clear.subtitle).not.toContain("overdue");
  });

  it("singularises a single remaining dose", () => {
    const only = occAt(COURSE_CLOVER_METACAM, "08:00");
    setState(only.key, "due");

    expect(buildTodayView(snapshotOf([only]), NOW, EN).subtitle).toBe(
      "1 dose left today",
    );
  });
});

describe("buildTodayView — counterLabel", () => {
  it("counts resolved and pending doses that have a due time", () => {
    const given = occAt(COURSE_CLOVER_METACAM, "08:00");
    const pending = occAt(COURSE_CLOVER_METACAM, "20:00");
    setState(given.key, "given");
    setState(pending.key, "later");

    expect(
      groupNamed(buildTodayView(snapshotOf([given, pending]), NOW, EN), "Clover")
        .counterLabel,
    ).toBe("1 of 2 today");
  });

  it("excludes a notStarted dose from Y", () => {
    const given = occAt(COURSE_CLOVER_METACAM, "08:00");
    const pending = occAt(COURSE_CLOVER_METACAM, "20:00");
    const none = occNotStarted(COURSE_CLOVER_METOCLOPRAMIDE);
    setState(given.key, "given");
    setState(pending.key, "later");
    setState(none.key, "notStarted");

    expect(
      groupNamed(
        buildTodayView(snapshotOf([given, pending, none]), NOW, EN),
        "Clover",
      ).counterLabel,
    ).toBe("1 of 2 today");
  });
});

describe("buildTodayView — body and keepResolved", () => {
  it("keeps a just-resolved dose in the body only while its key is held", () => {
    const given = occAt(COURSE_CLOVER_METACAM, "08:00");
    const pending = occAt(COURSE_CLOVER_METACAM, "20:00");
    setState(given.key, "given");
    setState(pending.key, "later");
    const snapshot = snapshotOf([given, pending]);

    const without = groupNamed(buildTodayView(snapshot, NOW, EN), "Clover");
    expect(without.body.map((d) => d.key)).toEqual([pending.key]);

    const withKept = groupNamed(
      buildTodayView(snapshot, NOW, EN, { keepResolved: new Set([given.key]) }),
      "Clover",
    );
    expect(withKept.body.map((d) => d.key)).toEqual([given.key, pending.key]);
    // The kept dose is still resolved, so it must not count as pending.
    expect(withKept.pending.map((d) => d.key)).toEqual([pending.key]);
  });
});

describe("buildTodayView — overdue banner", () => {
  it("reports the dose summariseDay named, not one it recomputed", () => {
    const early = occAt(COURSE_CLOVER_METACAM, "08:00");
    const late = occAt(COURSE_NUGGET_VITAMIN_C, "09:00");
    setState(early.key, "overdue");
    setState(late.key, "overdue");
    const named = engineDouble.summariseDay([early, late], NOW).earliestOverdue;

    const view = buildTodayView(snapshotOf([early, late]), NOW, EN);

    expect(view.overdue.count).toBe(2);
    expect(named?.key).toBe(early.key);
    expect(view.overdue.earliest?.key).toBe(named?.key);
    expect(view.overdue.petName).toBe("Clover");
  });

  it("has no earliest dose when nothing is overdue", () => {
    const occ = occAt(COURSE_CLOVER_METACAM, "08:00");
    setState(occ.key, "later");

    const view = buildTodayView(snapshotOf([occ]), NOW, EN);

    expect(view.overdue).toEqual({ count: 0, earliest: null, petName: null });
  });
});

describe("buildTodayView — empty state", () => {
  it("is empty when every dose is resolved and reports the next due time", () => {
    const given = occAt(COURSE_CLOVER_METACAM, "08:00");
    setState(given.key, "given");
    engineStore.nextDue = atLocalTime(DAY, "20:00");

    const view = buildTodayView(snapshotOf([given]), NOW, EN);

    expect(view.isEmpty).toBe(true);
    expect(view.emptyDetail).toBe("Next dose at 20:00");
  });

  it("is not empty while one dose is pending", () => {
    const occ = occAt(COURSE_CLOVER_METACAM, "08:00");
    setState(occ.key, "later");

    expect(buildTodayView(snapshotOf([occ]), NOW, EN).isEmpty).toBe(false);
  });

  it("says tomorrow for the next local day and names further days", () => {
    engineStore.nextDue = new Date(2026, 7, 9, 9, 0);
    expect(buildTodayView(snapshotOf([]), NOW, EN).emptyDetail).toBe(
      "Next dose tomorrow at 09:00",
    );

    engineStore.nextDue = new Date(2026, 7, 15, 7, 0);
    expect(buildTodayView(snapshotOf([]), NOW, EN).emptyDetail).toBe(
      "Next dose Sat 15 Aug at 07:00",
    );
  });

  it("is null when no active course has a next dose", () => {
    expect(buildTodayView(snapshotOf([]), NOW, EN).emptyDetail).toBeNull();
  });
});

describe("buildTodayView — comingUp", () => {
  it("announces a course ending in six days", () => {
    const ending: Course = {
      ...courseOf(COURSE_CLOVER_METACAM),
      endDate: "2026-08-14",
    };

    const view = buildTodayView(snapshotOf([], { courses: [ending] }), NOW, EN);

    expect(view.comingUp).toEqual({
      label: "Coming up · Clover's Metacam course ends",
      when: "in 6 days",
    });
  });

  it("falls back to the next weekly treatment the engine reports", () => {
    const weekly = courseOf(COURSE_NUGGET_IVERMECTIN);
    const day = "2026-08-10";
    setOccurrences(day, [
      makeOccurrence(weekly, {
        day,
        scheduledFor: atLocalTime(day, "07:00").toISOString(),
      }),
    ]);

    const view = buildTodayView(snapshotOf([], { courses: [weekly] }), NOW, EN);

    expect(view.comingUp).toEqual({
      label: "Coming up · Nugget's Ivermectin",
      when: "in 2 days",
    });
  });

  it("is null when nothing notable falls inside the window", () => {
    expect(buildTodayView(snapshotOf([], { courses: [] }), NOW, EN).comingUp).toBeNull();
  });
});

// Deliberate Ukrainian coverage (I18N-DESIGN.md §2.7): the model is the same
// pure function, driven with the other translator. These are the cases where
// Ukrainian is not a word-for-word swap — real one/few/many plural forms, a
// locale date, and the possessive that Ukrainian has no equivalent of.
describe("buildTodayView — Ukrainian", () => {
  const UK = createTranslator("uk");

  it("greets in Ukrainian on the same 12:00/18:00 cuts", () => {
    expect(greetingFor(new Date(2026, 7, 8, 11, 59), UK)).toBe("Доброго ранку");
    expect(greetingFor(new Date(2026, 7, 8, 12, 0), UK)).toBe("Доброго дня");
    expect(greetingFor(new Date(2026, 7, 8, 18, 0), UK)).toBe("Доброго вечора");
  });

  it("also greets before the morning cut and just before the evening cut, in Ukrainian", () => {
    // Mirrors the English "cuts at 12:00 and 18:00 local" test's four
    // boundary points, so both languages are pinned against the same clock
    // arithmetic — a regression that shifted the cut would fail here even if
    // the English test somehow kept passing.
    expect(greetingFor(new Date(2026, 7, 8, 17, 59), UK)).toBe("Доброго дня");
  });

  // The Today row's dose title ("Metacam 0.4 ml") is built by plain string
  // interpolation in `toDose`, never through the translator — so it must be
  // byte-identical in both languages. Pinned explicitly here rather than left
  // to inference, per I18N-DESIGN.md's "dose amounts never localize" rule.
  it("never localizes the dose amount in the Today row's title, even in Ukrainian", () => {
    const occ = occAt(COURSE_CLOVER_METACAM, "08:00");
    setState(occ.key, "later");

    const dose = groupNamed(buildTodayView(snapshotOf([occ]), NOW, UK), "Clover")
      .pending[0];

    expect(dose.title).toBe("Metacam 0.4 ml");
  });

  /** Registers `count` `due` occurrences of the same course and builds the view. */
  function subtitleForRemaining(count: number): string {
    const occs = Array.from({ length: count }, (_, i) => {
      const occ = occAt(COURSE_CLOVER_METACAM, `0${i}:00` as LocalTime);
      setState(occ.key, "due");
      return occ;
    });
    return buildTodayView(snapshotOf(occs), NOW, UK).subtitle;
  }

  it("uses real one/few/many forms for the remaining-dose count, never a suffix", () => {
    expect(subtitleForRemaining(1)).toBe("сьогодні залишилася 1 доза");
    expect(subtitleForRemaining(2)).toBe("сьогодні залишилося 2 дози");
    expect(subtitleForRemaining(5)).toBe("сьогодні залишилося 5 доз");
  });

  // n = 21 is the case that catches a naive implementation: Ukrainian's rule
  // makes 21 take the SAME singular form as 1 ("21 доза", not "21 доз") —
  // 20 distinct courses is too many to hand-build fixture occurrences for
  // (`occAt` only has 24 hour slots), so this pins the rule directly through
  // the catalogue entry `buildTodayView` actually calls (`today.subtitle`),
  // the same way `i18n/formatters.test.ts` and `HouseholdPage.test.tsx`
  // already pin their own n=21 cases.
  it("n = 21 stays singular, never '21 доз' — the same catalogue entry buildTodayView calls", () => {
    expect(UK.t("today.subtitle", { remaining: 21 })).toBe("сьогодні залишилася 21 доза");
  });

  it("appends the overdue clause in the many form", () => {
    const occs = Array.from({ length: 5 }, (_, i) => {
      const occ = occAt(COURSE_CLOVER_METACAM, `0${i}:00` as LocalTime);
      setState(occ.key, "overdue");
      return occ;
    });

    expect(buildTodayView(snapshotOf(occs), NOW, UK).subtitle).toBe(
      "сьогодні залишилося 5 доз · 5 прострочених",
    );
  });

  it("drops the overdue clause in Ukrainian too when M = 0, same as English", () => {
    const occ = occAt(COURSE_CLOVER_METACAM, "08:00");
    setState(occ.key, "later");

    const subtitle = buildTodayView(snapshotOf([occ]), NOW, UK).subtitle;

    expect(subtitle).toBe("сьогодні залишилася 1 доза");
    expect(subtitle).not.toContain("прострочен");
  });

  // The overdue banner's own count (`today.banner.overdueCount`), at every
  // pinned n. Not reachable through `buildTodayView` at n = 21 for the same
  // reason as the subtitle above, so the high end is pinned directly through
  // the same catalogue entry the view calls.
  it("real Ukrainian plural forms for the overdue banner count: n = 1, 2, 5, 21", () => {
    expect(UK.t("today.banner.overdueCount", { count: 1 })).toBe("1 доза прострочена");
    expect(UK.t("today.banner.overdueCount", { count: 2 })).toBe("2 дози прострочені");
    expect(UK.t("today.banner.overdueCount", { count: 5 })).toBe("5 доз прострочено");
    expect(UK.t("today.banner.overdueCount", { count: 21 })).toBe("21 доза прострочена");
    // English at 1 and 2 alongside, so a regression in either language is caught.
    expect(EN.t("today.banner.overdueCount", { count: 1 })).toBe("1 dose overdue");
    expect(EN.t("today.banner.overdueCount", { count: 2 })).toBe("2 doses overdue");
  });

  // "in N days" (the comingUp row's `today.when.inDays`). The engine only
  // ever asks for this inside a 7-day lookahead window (COMING_UP_DAYS), so
  // 5 is the largest value `buildTodayView` can produce it at in practice —
  // proven below via `comingUp`. n = 21 is still a real input the catalogue
  // entry must render correctly (a longer lookahead window is a config
  // change away, not a code change), so it is pinned directly too.
  it("real Ukrainian plural forms for 'in N days': n = 1, 2, 5 (via comingUp) and 21 (direct)", () => {
    expect(UK.t("today.when.inDays", { days: 2 })).toBe("через 2 дні");
    expect(UK.t("today.when.inDays", { days: 5 })).toBe("через 5 днів");
    expect(UK.t("today.when.inDays", { days: 21 })).toBe("через 21 день");
  });

  it("localizes the card status, the counter and the empty state's date", () => {
    const given = occAt(COURSE_CLOVER_METACAM, "08:00");
    const pending = occAt(COURSE_CLOVER_METACAM, "20:00");
    setState(given.key, "given");
    setState(pending.key, "overdue");

    const group = groupNamed(
      buildTodayView(snapshotOf([given, pending]), NOW, UK),
      "Clover",
    );
    expect(group.status).toBe("Прострочено з 20:00");
    expect(group.counterLabel).toBe("1 з 2 сьогодні");

    engineStore.nextDue = new Date(2026, 7, 15, 7, 0);
    // The date is `Intl.DateTimeFormat("uk-UA")`'s; the clock time is not
    // localized at all (SPEC §10a).
    expect(buildTodayView(snapshotOf([]), NOW, UK).emptyDetail).toBe(
      "Наступна доза сб, 15 серп. о 07:00",
    );
  });

  it("re-words the English possessive without declining either proper noun", () => {
    const ending: Course = {
      ...courseOf(COURSE_CLOVER_METACAM),
      endDate: "2026-08-14",
    };

    const view = buildTodayView(snapshotOf([], { courses: [ending] }), NOW, UK);

    // "Clover's Metacam course ends" has no Ukrainian equivalent, so the
    // clause is rebuilt analytically — and both names go in exactly as
    // stored, in the nominative, because they are DATA.
    expect(view.comingUp).toEqual({
      label: "Скоро · курс Metacam для Clover завершується",
      when: "через 6 днів",
    });
  });
});

describe("scheduledForOf", () => {
  it("round-trips through occurrenceKeyFor for a dated occurrence", () => {
    const occ = occAt(COURSE_CLOVER_METACAM, "08:00");

    expect(occurrenceKeyFor(occ.courseId, scheduledForOf(occ))).toBe(occ.key);
  });

  it("round-trips through occurrenceKeyFor for an unscheduled occurrence", () => {
    const occ = occNotStarted(COURSE_BISCUIT_METOCLOPRAMIDE);

    expect(scheduledForOf(occ)).toBeNull();
    expect(occurrenceKeyFor(occ.courseId, scheduledForOf(occ))).toBe(occ.key);
  });

  it("reads the key, not dueAt, so an anchored notStarted occurrence stays unscheduled", () => {
    // W2's engine widens `notStarted` to any occurrence whose canonical key is
    // `occurrenceKeyFor(courseId, null)` — including one that carries a
    // non-null `dueAt` because its course has an `anchorTime` (SPEC §3b).
    // Deriving `scheduledFor` from `dueAt` here would produce a value the key
    // does not agree with, and the write would miss its occurrence.
    const anchored: Occurrence = {
      ...occNotStarted(COURSE_BISCUIT_METOCLOPRAMIDE),
      dueAt: atLocalTime(DAY, "20:00"),
    };

    expect(scheduledForOf(anchored)).toBeNull();
    expect(occurrenceKeyFor(anchored.courseId, scheduledForOf(anchored))).toBe(
      anchored.key,
    );
  });
});
