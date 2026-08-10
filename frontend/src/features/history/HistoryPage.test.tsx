// SPEC §6.4 — Pet history: the full event log, filterable, grouped by day,
// with a summary strip, backward pagination and a text/CSV export. Every
// scenario below is seeded through the repo's real write methods
// (`createPet`, `createMedication`, `createCourse`, `logDose`,
// `recordMissed`, `setCourseStatus`, `adjustStock`, `upsertUser`) so course
// lifecycle events are recorded by the data layer exactly as production
// writes them — never hand-authored CourseEvent rows, which would prove
// nothing about the real write path (the one exception, noted at its use
// site, is a single hand-authored DoseEvent for an actorId no repo write can
// ever produce).
//
// `listDoseEvents`/`listCourseEvents` range-filter on `loggedAt`/`at`, which
// the repo always stamps from the CURRENT clock — never from the explicit
// `scheduledFor`/`givenAt` a caller passes. So every write below runs through
// `withClock`, which sets the fixed clock immediately before the call, to
// land each row in the day its scenario intends.
import { describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import { renderWithProviders, userEvent } from "@/test/renderWithProviders";
import { createMemoryRepo } from "@/data/memoryRepo";
import type { Repo } from "@/data/repo.types";
import {
  addLocalDays,
  atLocalTime,
  cloneFixtures,
  fixedClock,
  FIXTURE_NOW,
  localDayKey,
  occurrenceKeyFor,
  setClock,
  type Clock,
  type Household,
  type LocalDate,
  type User,
} from "@/domain";
import { createTranslator } from "@/i18n";
import { buildLogEntries } from "./logModel";
import { exportAsCsv, exportAsText } from "./historyExport";
import { HistoryView } from "./HistoryPage";

const TODAY = localDayKey(new Date(FIXTURE_NOW));
const YESTERDAY = addLocalDays(TODAY, -1);
const OLDER_DAY = addLocalDays(TODAY, -3);

/** Sets the fixed clock, then runs `fn` — every repo write's stamped fields key off it. */
async function withClock<T>(iso: string, fn: () => Promise<T>): Promise<T> {
  setClock(fixedClock(iso));
  return fn();
}

/**
 * A clock that genuinely advances by 1ms on every call — the same shape as
 * the browser's real `Date.now()`-backed clock the app runs under in
 * production, unlike `fixedClock`, which returns a byte-identical value no
 * matter how many times or how far apart it is called. Deterministic (no
 * dependency on real wall-clock time or how fast the test runs), but still
 * exercises "the value changes between two `now()` calls" the way the real
 * clock does.
 */
function tickingClock(startIso: string): Clock {
  let ms = new Date(startIso).getTime();
  return { now: () => new Date(ms++) };
}

async function seedCourse(
  repo: Repo,
  petId: string,
  medicationId: string,
  startDate: LocalDate,
  instructions: string | null = null,
) {
  return repo.createCourse({
    petId,
    medicationId,
    doseAmount: 0.4,
    doseUnit: "ml",
    instructions,
    schedule: { kind: "fixedTimes", times: ["08:00"] },
    startDate,
    endDate: null,
    notes: null,
  });
}

/**
 * Three days of Clover's real history, built entirely through repo writes:
 * an older day carrying only the course's own "started" entry, yesterday's
 * given + missed doses, and today's given + skipped doses plus a pause.
 * `instructions: "after food"` keeps every dose's detail line from reading
 * bare "Given"/"Skipped"/"Missed" — text the summary strip's own stat labels
 * also use, which would otherwise make `getByText` ambiguous.
 */
async function seedMixedScenario(): Promise<{ repo: Repo; petId: string }> {
  const repo = createMemoryRepo();
  const pet = await withClock(FIXTURE_NOW, () => repo.createPet({ name: "Clover", species: "rabbit" }));
  const medication = await withClock(FIXTURE_NOW, () =>
    repo.createMedication({ name: "Metacam", form: "liquid", unit: "ml" }),
  );

  const course = await withClock(atLocalTime(OLDER_DAY, "08:00").toISOString(), () =>
    seedCourse(repo, pet.id, medication.id, OLDER_DAY, "after food"),
  );

  const yGivenIso = atLocalTime(YESTERDAY, "08:00").toISOString();
  await withClock(yGivenIso, () =>
    repo.logDose({ courseId: course.id, status: "given", scheduledFor: yGivenIso, givenAt: yGivenIso, amount: 0.4 }),
  );

  const yMissedIso = atLocalTime(YESTERDAY, "20:00").toISOString();
  await withClock(yMissedIso, () =>
    repo.recordMissed([{ courseId: course.id, scheduledFor: yMissedIso, amount: 0.4 }]),
  );

  const tGivenIso = atLocalTime(TODAY, "06:00").toISOString();
  await withClock(tGivenIso, () =>
    repo.logDose({ courseId: course.id, status: "given", scheduledFor: tGivenIso, givenAt: tGivenIso, amount: 0.4 }),
  );

  // 07:15 is over an hour clear of 06:00's 60-min fixedTimes grace window, so
  // this doesn't trip the concurrent-log dedup guard.
  const tSkippedIso = atLocalTime(TODAY, "07:15").toISOString();
  await withClock(tSkippedIso, () =>
    repo.logDose({
      courseId: course.id,
      status: "skipped",
      scheduledFor: tSkippedIso,
      givenAt: tSkippedIso,
      amount: 0.4,
      note: "refused syringe",
    }),
  );

  // FIXTURE_NOW is 08:00 local — after every event above, at (or exactly on)
  // the render clock's own "now", so it lands inside the default page's
  // inclusive `to` bound.
  await withClock(FIXTURE_NOW, () => repo.setCourseStatus(course.id, "paused"));

  return { repo, petId: pet.id };
}

describe("HistoryView", () => {
  it("narrows via each filter chip and 'All' restores the full list", async () => {
    const { repo, petId } = await seedMixedScenario();
    renderWithProviders(<HistoryView petId={petId} />, { repo });
    const user = userEvent.setup();
    await screen.findByText("History");

    const rowCount = () => screen.getAllByText(/^by /).length;
    // 4 dose entries (2 given, 1 skipped, 1 missed) + 2 course entries
    // (started, paused) = 6. `findAllByText` (not `getAllByText`), because
    // the event-log queries only fire once `courses` has resolved.
    expect(await screen.findAllByText(/^by /)).toHaveLength(6);

    await user.click(screen.getByRole("button", { name: "Doses" }));
    expect(rowCount()).toBe(4);

    await user.click(screen.getByRole("button", { name: "Courses" }));
    expect(rowCount()).toBe(2);

    await user.click(screen.getByRole("button", { name: "All" }));
    expect(rowCount()).toBe(6);
  });

  // SPEC §10: state is never colour-only. `Chip` distinguishes the selected
  // filter by background/text colour alone, so the selection must also be
  // exposed programmatically or a screen-reader user cannot tell which
  // filter is active.
  it("exposes the selected filter through aria-pressed, not colour alone", async () => {
    const { repo, petId } = await seedMixedScenario();
    renderWithProviders(<HistoryView petId={petId} />, { repo });
    const user = userEvent.setup();
    await screen.findByText("History");

    const chip = (name: string) => screen.getByRole("button", { name });
    expect(chip("All")).toHaveAttribute("aria-pressed", "true");
    expect(chip("Doses")).toHaveAttribute("aria-pressed", "false");
    expect(chip("Courses")).toHaveAttribute("aria-pressed", "false");

    await user.click(chip("Doses"));
    expect(chip("Doses")).toHaveAttribute("aria-pressed", "true");
    expect(chip("All")).toHaveAttribute("aria-pressed", "false");
    expect(chip("Courses")).toHaveAttribute("aria-pressed", "false");
  });

  it("groups entries by day with Today/Yesterday/plain-date headings shaped 'Ddd D Mmm'", async () => {
    const { repo, petId } = await seedMixedScenario();
    renderWithProviders(<HistoryView petId={petId} />, { repo });
    await screen.findByText("History");

    // Shape only — the exact weekday/date text is derived from FIXTURE_NOW
    // by `dayLabel`, already unit-tested in logModel.test.ts; asserting the
    // literal string here would just re-hardcode a fixture-dependent value.
    // `findByText` for the first one: the day groups depend on the
    // event-log queries, which only fire once `courses` has resolved.
    expect(await screen.findByText(/^Today · [A-Za-z]{3} \d{1,2} [A-Za-z]{3}$/)).toBeInTheDocument();
    expect(screen.getByText(/^Yesterday · [A-Za-z]{3} \d{1,2} [A-Za-z]{3}$/)).toBeInTheDocument();
    expect(screen.getByText(/^[A-Za-z]{3} \d{1,2} [A-Za-z]{3}$/)).toBeInTheDocument();
  });

  it("summarises the full visible range and does not change when a filter chip is selected", async () => {
    const { repo, petId } = await seedMixedScenario();
    renderWithProviders(<HistoryView petId={petId} />, { repo });
    const user = userEvent.setup();
    await screen.findByText("History");

    function summaryCount(label: string): string {
      return screen.getByText(label).previousElementSibling?.textContent ?? "";
    }

    // The count starts blank (busy) until the event-log queries — gated on
    // `courses` resolving — land; `waitFor` for the first one only.
    await waitFor(() => expect(summaryCount("Given")).toBe("2"));
    expect(summaryCount("Skipped")).toBe("1");
    expect(summaryCount("Missed")).toBe("1");

    await user.click(screen.getByRole("button", { name: "Courses" }));
    expect(summaryCount("Given")).toBe("2");
    expect(summaryCount("Skipped")).toBe("1");
    expect(summaryCount("Missed")).toBe("1");

    await user.click(screen.getByRole("button", { name: "Doses" }));
    expect(summaryCount("Given")).toBe("2");
    expect(summaryCount("Skipped")).toBe("1");
    expect(summaryCount("Missed")).toBe("1");
  });

  // WHAT THIS TEST DOES COVER: the original bug where `now()` was called
  // directly in the render body, so a real ticking clock could never
  // stabilise a query key long enough for a fetch to land.
  //
  // WHAT IT DOES NOT COVER, and never did: the surviving Cause-A bug this
  // file's newer tests target, where the clock is held in state via
  // `useNow()` (so the render-body problem above is fixed) but the 30s
  // periodic re-emit still fed a millisecond-precision `to` into the query
  // key. This test swaps in `tickingClock` AFTER `renderWithProviders` has
  // already completed its synchronous initial mount, and `useNow` reads
  // `now()` exactly once, in its `useState` initialiser, during that
  // already-completed mount — every later render just returns the same
  // already-computed state value, so the ticking clock is never read by
  // `HistoryView` again and this test cannot see a periodic-tick regression.
  // It also runs under real timers, so `useNow`'s 30s `setTimeout` never
  // fires in a sub-second test run even if something did read the clock
  // again. See "does not mint a new event-log query key..." below, which
  // uses fake timers and an advanceable clock read from inside that timer's
  // callback, for the test that actually exercises the periodic tick.
  it("still renders entries once the clock genuinely advances between renders, not just under a frozen test clock", async () => {
    // Regression for a `now()` call inlined directly in the render body: it
    // returns a fresh instant on every render, which fed straight into the
    // event-log query keys, so a real (ticking) clock meant the query key
    // never stayed still long enough for a fetch to land before the next
    // render discarded it for a newer one — the screen stayed permanently
    // empty. Every other test in this file renders under
    // `renderWithProviders`' fixed clock, which returns the exact same
    // instant no matter how many times `now()` is called, so none of them
    // can see this: it is the one thing this test changes.
    const repo = createMemoryRepo();
    const pet = await withClock(FIXTURE_NOW, () => repo.createPet({ name: "Clover", species: "rabbit" }));
    const medication = await withClock(FIXTURE_NOW, () =>
      repo.createMedication({ name: "Metacam", form: "liquid", unit: "ml" }),
    );
    const course = await withClock(FIXTURE_NOW, () => seedCourse(repo, pet.id, medication.id, TODAY));
    const givenIso = atLocalTime(TODAY, "06:00").toISOString();
    await withClock(givenIso, () =>
      repo.logDose({ courseId: course.id, status: "given", scheduledFor: givenIso, givenAt: givenIso, amount: 0.4 }),
    );

    renderWithProviders(<HistoryView petId={pet.id} />, { repo });
    // Swap in the ticking clock right after the (synchronous) initial mount,
    // so every subsequent re-render — as `pet`/`courses`/`doseEvents` each
    // resolve — computes `now()` off a clock that has actually moved on,
    // exactly like the browser's clock does between the render that starts a
    // fetch and the render that receives its result.
    setClock(tickingClock(FIXTURE_NOW));

    await screen.findByText("History");
    // Course-started entry + the one given dose = 2 rows.
    expect(await screen.findAllByText(/^by /)).toHaveLength(2);
  });

  it("does not mint a new event-log query key when the clock genuinely ticks 30s (Cause A: `to` used to be a millisecond instant)", async () => {
    // Fake timers so `useNow`'s 30s `setTimeout` actually fires inside this
    // sub-second test; `shouldAdvanceTime` keeps `findBy*`/`waitFor`'s own
    // internal timeout-based polling working normally alongside it.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const repo = createMemoryRepo();
      const pet = await withClock(FIXTURE_NOW, () => repo.createPet({ name: "Clover", species: "rabbit" }));
      const medication = await withClock(FIXTURE_NOW, () =>
        repo.createMedication({ name: "Metacam", form: "liquid", unit: "ml" }),
      );
      const course = await withClock(FIXTURE_NOW, () => seedCourse(repo, pet.id, medication.id, TODAY));
      const givenIso = atLocalTime(TODAY, "06:00").toISOString();
      await withClock(givenIso, () =>
        repo.logDose({ courseId: course.id, status: "given", scheduledFor: givenIso, givenAt: givenIso, amount: 0.4 }),
      );

      const seen: string[] = [];
      const originalListDoseEvents = repo.listDoseEvents.bind(repo);
      repo.listDoseEvents = (filter) => {
        seen.push(JSON.stringify(filter));
        return originalListDoseEvents(filter);
      };

      // A clock whose `now()` reads a mutable `offset`, so a later mutation
      // of `offset` is visible to any `now()` call still holding a
      // reference to this same object — including one made from inside
      // `useNow`'s `setTimeout` callback, well after this line runs.
      let offset = 0;
      const advanceableClock = { now: () => new Date(new Date(FIXTURE_NOW).getTime() + offset) };
      setClock(advanceableClock);

      renderWithProviders(<HistoryView petId={pet.id} />, { repo });
      // `renderWithProviders` installs its own frozen `fixedClock(FIXTURE_NOW)`
      // immediately before it renders (see its own "install the clock BEFORE
      // anything renders" comment) — which would otherwise clobber the
      // advanceable clock installed above for the remainder of the test.
      // Re-asserted here, straight after render, so it — not the harness's
      // frozen one — is what's active when `useNow`'s effect (already
      // scheduled during the mount above) later reads `now()`.
      setClock(advanceableClock);

      expect(await screen.findAllByText(/^by /)).toHaveLength(2);
      const before = new Set(seen).size;

      // Advance the clock by a full minute (never crosses midnight from
      // 08:00 local) and let the 30s timer fire.
      await act(async () => {
        offset = 60_000;
        vi.advanceTimersByTime(30_001);
      });

      // The tick minted no new query key...
      expect(new Set(seen).size).toBe(before);
      // ...and the rows never blanked out along the way.
      expect(await screen.findAllByText(/^by /)).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never shows 0 in the given/skipped/missed strip while data is still loading, when the pet has events today (Cause B/C)", async () => {
    const repo = createMemoryRepo();
    const pet = await withClock(FIXTURE_NOW, () => repo.createPet({ name: "Clover", species: "rabbit" }));
    const medication = await withClock(FIXTURE_NOW, () =>
      repo.createMedication({ name: "Metacam", form: "liquid", unit: "ml" }),
    );
    // "after food" instructions keep the dose's detail line from reading
    // bare "Given" — text the summary strip's own stat label also uses,
    // which would otherwise make `getByText("Given")` ambiguous once the
    // row renders (same idiom `seedMixedScenario` above uses).
    const course = await withClock(FIXTURE_NOW, () =>
      seedCourse(repo, pet.id, medication.id, TODAY, "after food"),
    );
    const givenIso = atLocalTime(TODAY, "06:00").toISOString();
    await withClock(givenIso, () =>
      repo.logDose({ courseId: course.id, status: "given", scheduledFor: givenIso, givenAt: givenIso, amount: 0.4 }),
    );

    // Holds `listCourses` open until the test releases it, so `courses.data`
    // stays `undefined` (and, per the `enabled` gate, the event-log queries
    // never even fire) for as long as the test wants — deterministically
    // reproducing "the screen paints before the real data has arrived"
    // without racing real async timing.
    const originalListCourses = repo.listCourses.bind(repo);
    let releaseCourses!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseCourses = resolve;
    });
    repo.listCourses = async (filter) => {
      const result = await originalListCourses(filter);
      await gate;
      return result;
    };

    renderWithProviders(<HistoryView petId={pet.id} />, { repo });
    // The header, independent of `courses`, still renders straight away.
    await screen.findByText("History");

    const summaryCount = (label: string) => screen.getByText(label).previousElementSibling?.textContent ?? "";

    // Busy: blank, never a misleading "0" — Clover in fact has a given dose
    // today, so a "0" here would be actively wrong, not just uninformative.
    expect(summaryCount("Given")).toBe("");
    expect(summaryCount("Skipped")).toBe("");
    expect(summaryCount("Missed")).toBe("");

    releaseCourses();
    await waitFor(() => expect(summaryCount("Given")).toBe("1"));
    expect(summaryCount("Skipped")).toBe("0");
    expect(summaryCount("Missed")).toBe("0");
  });

  it("renders each row with a trailing 'by <name>'", async () => {
    const repo = createMemoryRepo();
    const pet = await withClock(FIXTURE_NOW, () => repo.createPet({ name: "Clover", species: "rabbit" }));
    const medication = await withClock(FIXTURE_NOW, () =>
      repo.createMedication({ name: "Metacam", form: "liquid", unit: "ml" }),
    );
    const course = await withClock(FIXTURE_NOW, () => seedCourse(repo, pet.id, medication.id, TODAY));
    const givenIso = atLocalTime(TODAY, "06:00").toISOString();
    await withClock(givenIso, () =>
      repo.logDose({ courseId: course.id, status: "given", scheduledFor: givenIso, givenAt: givenIso, amount: 0.4 }),
    );

    renderWithProviders(<HistoryView petId={pet.id} />, { repo });
    await screen.findByText("History");

    const self = await repo.getCurrentUser();
    expect(await screen.findAllByText(`by ${self.displayName}`)).not.toHaveLength(0);
  });

  // Regression for the row squeezing its title/detail column down to a
  // near-single-word sliver at 360px when a long (e.g. Ukrainian) attribution
  // couldn't shrink below its `white-space: nowrap` content width. SPEC
  // §10a: nothing is truncated to fit — the row wraps the attribution onto
  // its own line instead.
  it("lets the row wrap rather than truncating the attribution", async () => {
    const repo = createMemoryRepo();
    const pet = await withClock(FIXTURE_NOW, () => repo.createPet({ name: "Clover", species: "rabbit" }));
    const medication = await withClock(FIXTURE_NOW, () =>
      repo.createMedication({ name: "Metacam", form: "liquid", unit: "ml" }),
    );
    const course = await withClock(FIXTURE_NOW, () => seedCourse(repo, pet.id, medication.id, TODAY));
    const givenIso = atLocalTime(TODAY, "06:00").toISOString();
    await withClock(givenIso, () =>
      repo.logDose({ courseId: course.id, status: "given", scheduledFor: givenIso, givenAt: givenIso, amount: 0.4 }),
    );

    renderWithProviders(<HistoryView petId={pet.id} />, { repo });
    await screen.findByText("History");

    const attribution = (await screen.findAllByText(/^by /))[0];
    expect(attribution.style.whiteSpace).not.toBe("nowrap");

    const row = attribution.parentElement;
    expect(row).not.toBeNull();
    expect(row?.style.flexWrap).toBe("wrap");

    // jsdom does no layout, so it cannot reproduce the 360px measurement
    // directly, but it can assert the style contract that measurement
    // showed to be load-bearing. Browser measurement on the broken build:
    // title/detail column `width 41.5px, height 153.5px` (text broken into
    // near-single-character lines) while the attribution sat beside it at
    // `width 150.5px, height 20px` — flexWrap: "wrap" never fired. Root
    // cause: the column carried the bare `flex: 1` shorthand, which expands
    // to `flex: 1 1 0%` (flex-basis 0). Flex line-wrapping decides from each
    // item's hypothetical main size — its flex-basis — not its rendered
    // size, so a basis-0 title column never contributes to the row's total
    // and the row (240.5px) never exceeds the ~284px content box. A bare
    // `flex: 1` (or explicit `flex: 1 1 0%`) here silently disables the
    // wrap and reintroduces the sliver, even with flexWrap: "wrap" present.
    const titleColumn = attribution.previousElementSibling as HTMLElement | null;
    expect(titleColumn).not.toBeNull();
    expect(titleColumn?.style.flex).not.toBe("1");
    expect(titleColumn?.style.flex).not.toBe("1 1 0%");
  });

  it("renders 'by Someone' for an event whose actorId matches no household member", async () => {
    // Every repo write stamps `currentActorId()`, so an unknown-actor row can
    // never come out of the write path — only out of data the repo did not
    // itself produce (e.g. a synced row from a member removed on another
    // device). Seeded directly for that reason, the same technique
    // PetDetailPage.test.tsx and logModel.test.ts use for the same
    // otherwise-unreachable case (SPEC §5: "render 'Someone' rather than an
    // email").
    const custom = cloneFixtures();
    const pet = custom.pets.find((p) => p.name === "Clover")!;
    const course = custom.courses.find((c) => c.petId === pet.id && c.schedule.kind === "fixedTimes")!;
    const ghostIso = atLocalTime(TODAY, "05:00").toISOString();
    custom.doseEvents.push({
      id: "ghost-dose",
      courseId: course.id,
      scheduledFor: ghostIso,
      status: "given",
      loggedAt: ghostIso,
      givenAt: ghostIso,
      amount: course.doseAmount,
      note: null,
      occurrenceKey: occurrenceKeyFor(course.id, ghostIso),
      supersedesId: null,
      actorId: "ghost-actor-id",
      createdAt: ghostIso,
      updatedAt: ghostIso,
      deletedAt: null,
    });
    const repo = createMemoryRepo(custom);

    renderWithProviders(<HistoryView petId={pet.id} />, { repo });
    await screen.findByText("History");

    expect(await screen.findAllByText(/^by Someone$/)).not.toHaveLength(0);
    expect(screen.getAllByText(/^by Roman$/).length).toBeGreaterThan(0);
  });

  it(
    "shows a course pause even across a second pause/resume cycle — the ledger, not the " +
      "course's own last-transition fields (SPEC §12)",
    async () => {
      const repo = createMemoryRepo();
      const pet = await withClock(FIXTURE_NOW, () => repo.createPet({ name: "Clover", species: "rabbit" }));
      const medication = await withClock(FIXTURE_NOW, () =>
        repo.createMedication({ name: "Metacam", form: "liquid", unit: "ml" }),
      );
      // FIXTURE_NOW is 08:00 local; every transition below stays same-day and
      // strictly before it, so all four land inside the default page.
      const course = await withClock(atLocalTime(TODAY, "04:00").toISOString(), () =>
        seedCourse(repo, pet.id, medication.id, TODAY),
      );

      await withClock(atLocalTime(TODAY, "05:00").toISOString(), () =>
        repo.setCourseStatus(course.id, "paused"),
      ); // first pause
      await withClock(atLocalTime(TODAY, "06:00").toISOString(), () =>
        repo.setCourseStatus(course.id, "active"),
      ); // resume
      await withClock(atLocalTime(TODAY, "07:00").toISOString(), () =>
        repo.setCourseStatus(course.id, "paused"),
      ); // second pause — the one a Course.updatedAt/resumedAt derivation cannot survive

      renderWithProviders(<HistoryView petId={pet.id} />, { repo });
      await screen.findByText("History");

      // Both pauses present (not collapsed to "latest only"), plus the
      // resume and the original start — the full ledger, not a snapshot.
      expect(await screen.findAllByText("Course paused")).toHaveLength(2);
      expect(screen.getAllByText("Course resumed")).toHaveLength(1);
      expect(screen.getAllByText(/^Course started/)).toHaveLength(1);
    },
  );

  it("excludes stock adjustments and household member joins from the log (SPEC §6.4)", async () => {
    const repo = createMemoryRepo();
    const pet = await withClock(FIXTURE_NOW, () => repo.createPet({ name: "Clover", species: "rabbit" }));
    const medication = await withClock(FIXTURE_NOW, () =>
      repo.createMedication({ name: "Metacam", form: "liquid", unit: "ml" }),
    );
    const course = await withClock(FIXTURE_NOW, () => seedCourse(repo, pet.id, medication.id, TODAY));
    const givenIso = atLocalTime(TODAY, "06:00").toISOString();
    await withClock(givenIso, () =>
      repo.logDose({ courseId: course.id, status: "given", scheduledFor: givenIso, givenAt: givenIso, amount: 0.4 }),
    );

    // Two real writes SPEC §6.4 says must NOT surface in the pet's history.
    await withClock(FIXTURE_NOW, () =>
      repo.adjustStock({ medicationId: medication.id, deltaUnits: 5, reason: "purchase", note: "New bottle" }),
    );
    const householdId = await repo.currentHouseholdId();
    await withClock(FIXTURE_NOW, () =>
      repo.upsertUser({
        id: "joiner-1",
        householdId,
        email: null,
        displayName: "Marta",
        tint: 2,
        isSelf: false,
        joinedAt: FIXTURE_NOW,
        createdAt: FIXTURE_NOW,
        updatedAt: FIXTURE_NOW,
        deletedAt: null,
      }),
    );

    renderWithProviders(<HistoryView petId={pet.id} />, { repo });
    await screen.findByText("History");

    // The course's own "started" entry plus the one dose above = 2 rows;
    // neither the stock purchase nor Marta's join adds a third.
    expect(await screen.findAllByText(/^by /)).toHaveLength(2);
    expect(screen.queryByText(/New bottle/)).not.toBeInTheDocument();
    expect(screen.queryByText("Marta")).not.toBeInTheDocument();
  });

  it("Load earlier pages backwards 30 days without duplicating a row at the boundary", async () => {
    const repo = createMemoryRepo();
    const pet = await withClock(FIXTURE_NOW, () => repo.createPet({ name: "Clover", species: "rabbit" }));
    const medication = await withClock(FIXTURE_NOW, () =>
      repo.createMedication({ name: "Metacam", form: "liquid", unit: "ml" }),
    );
    const course = await withClock(FIXTURE_NOW, () => seedCourse(repo, pet.id, medication.id, TODAY));

    // Page 1 covers [today - 29, today]; day -29 is its oldest, inclusive day.
    const boundaryDay = addLocalDays(TODAY, -29);
    // Only page 2's wider [today - 59, today] window reaches this far back.
    const beyondPage1Day = addLocalDays(TODAY, -35);

    const boundaryIso = atLocalTime(boundaryDay, "12:00").toISOString();
    await withClock(boundaryIso, () =>
      repo.logDose({
        courseId: course.id,
        status: "given",
        scheduledFor: boundaryIso,
        givenAt: boundaryIso,
        amount: 0.4,
        note: "boundary-marker",
      }),
    );

    const olderIso = atLocalTime(beyondPage1Day, "12:00").toISOString();
    await withClock(olderIso, () =>
      repo.logDose({
        courseId: course.id,
        status: "given",
        scheduledFor: olderIso,
        givenAt: olderIso,
        amount: 0.4,
        note: "older-marker",
      }),
    );

    renderWithProviders(<HistoryView petId={pet.id} />, { repo });
    const user = userEvent.setup();
    await screen.findByText("History");

    expect(await screen.findAllByText(/boundary-marker/)).toHaveLength(1);
    expect(screen.queryByText(/older-marker/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Load earlier" }));

    // The newly-reachable day appears, and the already-visible boundary row
    // is not fetched-and-rendered a second time.
    expect(await screen.findAllByText(/older-marker/)).toHaveLength(1);
    expect(screen.getAllByText(/boundary-marker/)).toHaveLength(1);
  });

  it("exports the visible range as plain text and CSV, matching exportAsText/exportAsCsv over the same entries", async () => {
    const repo = createMemoryRepo();
    const pet = await withClock(FIXTURE_NOW, () => repo.createPet({ name: "Clover", species: "rabbit" }));
    const medication = await withClock(FIXTURE_NOW, () =>
      repo.createMedication({ name: "Metacam", form: "liquid", unit: "ml" }),
    );
    const course = await withClock(FIXTURE_NOW, () => seedCourse(repo, pet.id, medication.id, TODAY));
    const givenIso = atLocalTime(TODAY, "06:00").toISOString();
    await withClock(givenIso, () =>
      repo.logDose({ courseId: course.id, status: "given", scheduledFor: givenIso, givenAt: givenIso, amount: 0.4 }),
    );

    renderWithProviders(<HistoryView petId={pet.id} />, { repo });
    const user = userEvent.setup();
    await screen.findByText("History");

    // The menu is a Base UI `Menu` (portalled), so its items mount
    // asynchronously after the trigger click — `findByRole`, not `getByRole`.
    await user.click(screen.getByRole("button", { name: "Export history" }));
    expect(await screen.findByRole("menuitem", { name: "Plain text" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "CSV" })).toBeInTheDocument();

    // The download itself is unobservable in jsdom (no `URL.createObjectURL`
    // — HistoryPage.tsx's `downloadText` no-ops without it), so the exported
    // content is verified independently: build the same entries the screen
    // did over the same visible range, and confirm `exportAsText`/
    // `exportAsCsv` (imported read-only) render them correctly.
    const courses = await repo.listCourses({ petId: pet.id });
    const medications = await repo.listMedications();
    const courseIds = courses.map((c) => c.id);
    const doseEvents = await repo.listDoseEvents({ courseIds });
    const courseEvents = await repo.listCourseEvents({ courseIds });
    const entries = buildLogEntries({ courses, medications, doseEvents, courseEvents });
    const ctx = { petName: "Clover", from: TODAY, to: TODAY, nameFor: () => "You" };
    // The screen renders under the harness's pinned English locale, so the
    // independent re-export uses the same translator it did.
    const tr = createTranslator("en");

    const text = exportAsText(entries, ctx, tr);
    expect(text).toContain("Clover — history");
    expect(text).toContain("Metacam 0.4 ml");
    expect(text).toContain("by You");

    const csv = exportAsCsv(entries, ctx, tr);
    const csvRows = csv.trimEnd().split("\n");
    expect(csvRows[0]).toBe('"date","time","type","medication","detail","by"');
    expect(csv).toContain("Metacam 0.4 ml");

    // Both menu items are wired to a real handler: clicking either closes
    // the export menu without throwing.
    await user.click(screen.getByRole("menuitem", { name: "Plain text" }));
    await waitFor(() =>
      expect(screen.queryByRole("menuitem", { name: "Plain text" })).not.toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Export history" }));
    await user.click(await screen.findByRole("menuitem", { name: "CSV" }));
    await waitFor(() => expect(screen.queryByRole("menuitem", { name: "CSV" })).not.toBeInTheDocument());
  });

  it("closes the export menu on Escape and returns focus to its trigger (accessibility fix — was inescapable by keyboard)", async () => {
    const repo = createMemoryRepo();
    const pet = await withClock(FIXTURE_NOW, () => repo.createPet({ name: "Clover", species: "rabbit" }));
    renderWithProviders(<HistoryView petId={pet.id} />, { repo });
    const user = userEvent.setup();
    await screen.findByText("History");

    const trigger = screen.getByRole("button", { name: "Export history" });
    await user.click(trigger);
    await screen.findByRole("menuitem", { name: "Plain text" });

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("dismisses the export menu on a click outside it", async () => {
    const repo = createMemoryRepo();
    const pet = await withClock(FIXTURE_NOW, () => repo.createPet({ name: "Clover", species: "rabbit" }));
    renderWithProviders(<HistoryView petId={pet.id} />, { repo });
    const user = userEvent.setup();
    await screen.findByText("History");

    await user.click(screen.getByRole("button", { name: "Export history" }));
    await screen.findByRole("menuitem", { name: "Plain text" });

    await user.click(screen.getByText("History"));

    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("gives the back button an accessible name", async () => {
    const repo = createMemoryRepo();
    const pet = await withClock(FIXTURE_NOW, () => repo.createPet({ name: "Clover", species: "rabbit" }));
    renderWithProviders(<HistoryView petId={pet.id} />, { repo });
    await screen.findByText("History");

    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });

  it("renders exactly one <h1>, the screen title", async () => {
    const repo = createMemoryRepo();
    const pet = await withClock(FIXTURE_NOW, () => repo.createPet({ name: "Clover", species: "rabbit" }));
    const { container } = renderWithProviders(<HistoryView petId={pet.id} />, { repo });
    await screen.findByText("History");

    const headings = container.querySelectorAll("h1");
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe("History");
  });

  it("renders dose rows in the order they are DISPLAYED (SPEC §6.4), not the order they were scheduled", async () => {
    const repo = createMemoryRepo();
    const pet = await withClock(FIXTURE_NOW, () => repo.createPet({ name: "Clover", species: "rabbit" }));
    const medication = await withClock(FIXTURE_NOW, () =>
      repo.createMedication({ name: "Metacam", form: "liquid", unit: "ml" }),
    );
    const medicationB = await withClock(FIXTURE_NOW, () =>
      repo.createMedication({ name: "Rimadyl", form: "tablet", unit: "tablet" }),
    );
    // Two different courses so the repo's dedup guard (doses within the
    // fixedTimes grace window of one another, checked per-course) never
    // fires between the two doses below.
    const courseA = await withClock(FIXTURE_NOW, () => seedCourse(repo, pet.id, medication.id, TODAY));
    const courseB = await withClock(FIXTURE_NOW, () => seedCourse(repo, pet.id, medicationB.id, TODAY));

    // Dose A: scheduled 05:00, given 07:50 -> displays "07:50".
    // Dose B: scheduled 07:00, given 07:40 -> displays "07:40".
    // Sorting by the scheduling instant (the pre-fix bug) would put B
    // (scheduled 07:00) ahead of A (scheduled 05:00) — the wrong order, since
    // the rows actually read "07:50" then "07:40" to the user. Sorting by the
    // displayed instant correctly puts A ahead of B.
    const aScheduled = atLocalTime(TODAY, "05:00").toISOString();
    const aGiven = atLocalTime(TODAY, "07:50").toISOString();
    await withClock(aGiven, () =>
      repo.logDose({
        courseId: courseA.id,
        status: "given",
        scheduledFor: aScheduled,
        givenAt: aGiven,
        amount: 0.4,
      }),
    );

    const bScheduled = atLocalTime(TODAY, "07:00").toISOString();
    const bGiven = atLocalTime(TODAY, "07:40").toISOString();
    await withClock(bGiven, () =>
      repo.logDose({
        courseId: courseB.id,
        status: "given",
        scheduledFor: bScheduled,
        givenAt: bGiven,
        amount: 0.4,
      }),
    );

    renderWithProviders(<HistoryView petId={pet.id} />, { repo });
    await screen.findByText("History");

    const times = (await screen.findAllByText(/^\d{2}:\d{2}$/)).map((el) => el.textContent);
    expect(times.indexOf("07:50")).toBeGreaterThanOrEqual(0);
    expect(times.indexOf("07:40")).toBeGreaterThanOrEqual(0);
    expect(times.indexOf("07:50")).toBeLessThan(times.indexOf("07:40"));
  });

  it("never renders an email address anywhere in the screen (SPEC §12)", async () => {
    const EMAIL = "clover.mum@example.com";
    const household: Household = {
      id: "hh-email-test",
      name: "Home",
      createdAt: FIXTURE_NOW,
      updatedAt: FIXTURE_NOW,
      deletedAt: null,
    };
    const selfUser: User = {
      id: "user-email-test",
      householdId: household.id,
      email: EMAIL,
      displayName: "Clover's Mum",
      tint: 1,
      isSelf: true,
      joinedAt: FIXTURE_NOW,
      createdAt: FIXTURE_NOW,
      updatedAt: FIXTURE_NOW,
      deletedAt: null,
    };
    const repo = createMemoryRepo({ household, users: [selfUser] });

    const pet = await withClock(FIXTURE_NOW, () => repo.createPet({ name: "Clover", species: "rabbit" }));
    const medication = await withClock(FIXTURE_NOW, () =>
      repo.createMedication({ name: "Metacam", form: "liquid", unit: "ml" }),
    );
    const course = await withClock(FIXTURE_NOW, () => seedCourse(repo, pet.id, medication.id, TODAY));
    const givenIso = atLocalTime(TODAY, "06:00").toISOString();
    await withClock(givenIso, () =>
      repo.logDose({ courseId: course.id, status: "given", scheduledFor: givenIso, givenAt: givenIso, amount: 0.4 }),
    );

    const { container } = renderWithProviders(<HistoryView petId={pet.id} />, { repo });
    await screen.findByText("History");

    expect(container.textContent).not.toContain(EMAIL);
    expect(container.textContent).not.toContain("clover.mum");
  });

  // Pre-localization this line read `${n} active courses` unconditionally, so
  // a single course rendered "1 active courses". Routing the count through a
  // real plural rule (SPEC §10a: "pluralization is a rule, not a suffix")
  // corrects it.
  it("pluralizes the active-course count — one course reads '1 active course'", async () => {
    const { repo, petId } = await seedMixedScenario();
    renderWithProviders(<HistoryView petId={petId} />, { repo });
    await screen.findByText("History");

    expect(screen.getByText("Rabbit · 1 active course")).toBeInTheDocument();
  });

  it("renders the whole screen in Ukrainian under a Ukrainian locale", async () => {
    const { repo, petId } = await seedMixedScenario();
    renderWithProviders(<HistoryView petId={petId} />, { repo, locale: "uk" });

    await screen.findByText("Історія");
    expect(screen.getByText("Кріль · 1 активний курс")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Усі" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Дози" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Курси" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Експортувати історію" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Назад" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Завантажити раніші" })).toBeInTheDocument();
    // A day heading, a detail line and an attribution, all localized — and a
    // clock time still 24-hour and unlocalized (SPEC §10a). `findByText` for
    // the first one: the day groups depend on the event-log queries, which
    // only fire once `courses` has resolved.
    expect(await screen.findByText(/^Сьогодні · /)).toBeInTheDocument();
    expect(screen.getAllByText(/^виконано: /).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Курс призупинено$/).length).toBe(1);
    expect(screen.getAllByText(/^\d{2}:\d{2}$/).length).toBeGreaterThan(0);
    // No English copy left on the screen.
    expect(screen.queryByText("History")).not.toBeInTheDocument();
    expect(screen.queryByText(/active courses?$/)).not.toBeInTheDocument();
  });

  // Deliberate Ukrainian coverage of the two counts this screen composes:
  // `history.subtitle`'s course clause (rendered above at n = 1 through a
  // real screen) and `history.eventCount`'s per-day-group trailing count
  // (not yet exercised in Ukrainian at all). n = 2, 5 and 21 are pinned
  // directly through the exact catalogue entries `HistoryPage.tsx` calls —
  // seeding 21 distinct courses or 21 events in one day group would test
  // fixture-building, not the plural rule the n = 1 render already proves is
  // wired correctly.
  it("history.subtitle: real Ukrainian one/few/many forms at n = 1, 2, 5, 21", () => {
    const uk = createTranslator("uk");
    const en = createTranslator("en");
    expect(uk.t("history.subtitle", { species: "Кріль", courses: 1 })).toBe(
      "Кріль · 1 активний курс",
    );
    expect(uk.t("history.subtitle", { species: "Кріль", courses: 2 })).toBe(
      "Кріль · 2 активні курси",
    );
    expect(uk.t("history.subtitle", { species: "Кріль", courses: 5 })).toBe(
      "Кріль · 5 активних курсів",
    );
    expect(uk.t("history.subtitle", { species: "Кріль", courses: 21 })).toBe(
      "Кріль · 21 активний курс",
    );
    // English at 1 and 2 alongside, so a regression in either language is caught.
    expect(en.t("history.subtitle", { species: "Rabbit", courses: 1 })).toBe(
      "Rabbit · 1 active course",
    );
    expect(en.t("history.subtitle", { species: "Rabbit", courses: 2 })).toBe(
      "Rabbit · 2 active courses",
    );
  });

  it("history.eventCount: real Ukrainian one/few/many forms at n = 1, 2, 5, 21", () => {
    const uk = createTranslator("uk");
    const en = createTranslator("en");
    expect(uk.t("history.eventCount", { count: 1 })).toBe("1 подія");
    expect(uk.t("history.eventCount", { count: 2 })).toBe("2 події");
    expect(uk.t("history.eventCount", { count: 5 })).toBe("5 подій");
    expect(uk.t("history.eventCount", { count: 21 })).toBe("21 подія");
    expect(en.t("history.eventCount", { count: 1 })).toBe("1 event");
    expect(en.t("history.eventCount", { count: 2 })).toBe("2 events");
  });
});
