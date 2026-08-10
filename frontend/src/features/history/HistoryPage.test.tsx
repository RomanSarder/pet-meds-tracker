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
import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
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
    // (started, paused) = 6.
    expect(rowCount()).toBe(6);

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
    expect(screen.getByText(/^Today · [A-Za-z]{3} \d{1,2} [A-Za-z]{3}$/)).toBeInTheDocument();
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

    expect(summaryCount("Given")).toBe("2");
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
    expect(screen.getAllByText(`by ${self.displayName}`).length).toBeGreaterThan(0);
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

    expect(screen.getAllByText(/^by Someone$/).length).toBeGreaterThan(0);
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
    expect(screen.getAllByText(/^by /)).toHaveLength(2);
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

    expect(screen.getAllByText(/boundary-marker/)).toHaveLength(1);
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
    // clock time still 24-hour and unlocalized (SPEC §10a).
    expect(screen.getByText(/^Сьогодні · /)).toBeInTheDocument();
    expect(screen.getAllByText(/^виконано: /).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Курс призупинено$/).length).toBe(1);
    expect(screen.getAllByText(/^\d{2}:\d{2}$/).length).toBeGreaterThan(0);
    // No English copy left on the screen.
    expect(screen.queryByText("History")).not.toBeInTheDocument();
    expect(screen.queryByText(/active courses?$/)).not.toBeInTheDocument();
  });
});
