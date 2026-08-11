// "Edit time" on a past dose, driven end to end through the real screen and
// the real repo: open the row's overflow, move the time, save, and check both
// what the log now says and what the SCHEDULER now believes.
//
// The scheduler half is the point. The product rule is "editing a past dose
// changes that entry and nothing else, unless it was the last dose", and a
// test that only read the rendered row would pass just as happily if the
// whole chain had silently moved underneath it. So every scenario asserts
// `nextDueAt` over the repo's own rows after the write.
//
// Every write goes through `withClock` for the reason `HistoryPage.test.tsx`
// states: `listDoseEvents` range-filters on `loggedAt`, which the repo always
// stamps from the current clock, never from the `givenAt` a caller passes.
import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders, userEvent } from "@/test/renderWithProviders";
import { createMemoryRepo } from "@/data/memoryRepo";
import type { Repo } from "@/data/repo.types";
import {
  addLocalDays,
  atLocalTime,
  fixedClock,
  FIXTURE_NOW,
  formatHHMM,
  localDayKey,
  setClock,
  type Course,
  type DoseEvent,
} from "@/domain";
import { nextDueAt } from "@/engine";
import { HistoryView } from "./HistoryPage";

const TODAY = localDayKey(new Date(FIXTURE_NOW));
const YESTERDAY = addLocalDays(TODAY, -1);

async function withClock<T>(iso: string, fn: () => Promise<T>): Promise<T> {
  setClock(fixedClock(iso));
  return fn();
}

function at(day: string, time: string): Date {
  return atLocalTime(day, time);
}

/**
 * A `fromLastDose` course with two given doses yesterday — 06:00 and 16:00,
 * ten hours apart so neither trips the 90-minute interval dedup guard. The
 * chain therefore counts from 16:00 and sits at 00:00 today.
 */
async function seedChain(): Promise<{ repo: Repo; petId: string; course: Course }> {
  const repo = createMemoryRepo();
  const pet = await withClock(FIXTURE_NOW, () => repo.createPet({ name: "Clover", species: "rabbit" }));
  const medication = await withClock(FIXTURE_NOW, () =>
    repo.createMedication({ name: "Metacam", form: "liquid", unit: "ml" }),
  );
  // 03:00, clear of every time this file moves a dose to — the course's own
  // "Course started" row shows this instant, and a collision would make
  // `getByText("05:00")` ambiguous between it and the dose row.
  const course = await withClock(at(YESTERDAY, "03:00").toISOString(), () =>
    repo.createCourse({
      petId: pet.id,
      medicationId: medication.id,
      doseAmount: 0.4,
      doseUnit: "ml",
      instructions: null,
      schedule: { kind: "fromLastDose", intervalHours: 8 },
      startDate: YESTERDAY,
      endDate: null,
      notes: null,
    }),
  );

  for (const time of ["06:00", "16:00"]) {
    const iso = at(YESTERDAY, time).toISOString();
    await withClock(iso, () =>
      repo.logDose({ courseId: course.id, status: "given", scheduledFor: null, givenAt: iso, amount: 0.4 }),
    );
  }

  return { repo, petId: pet.id, course };
}

/** What the engine says the course's next dose is, over the repo's live rows. */
async function nextDueFromRepo(repo: Repo, course: Course, after: Date): Promise<Date | null> {
  const events = await repo.listDoseEvents({ courseId: course.id });
  return nextDueAt(course, events, after);
}

async function liveGivenTimes(repo: Repo, courseId: string): Promise<string[]> {
  const events = await repo.listDoseEvents({ courseId });
  const superseded = new Set(events.filter((e) => e.supersedesId !== null).map((e) => e.supersedesId));
  return events
    .filter((e: DoseEvent) => e.status === "given" && e.deletedAt === null && !superseded.has(e.id))
    .map((e) => formatHHMM(new Date(e.givenAt)))
    .sort();
}

/**
 * The open sheet. Scoping every query to it matters more here than in most
 * tests: the sheet is a portal over a screen that still has every row in the
 * DOM, so a bare `getByText("16:00")` finds the row behind it too.
 */
function sheet(): HTMLElement {
  return screen.getByRole("dialog");
}

/** U+2212 MINUS SIGN — the character the catalogue actually renders, not a hyphen. */
const MINUS = "\u2212";

/** The row overflows, newest row first — index 0 is the most recent dose. */
function overflowTriggers(): HTMLElement[] {
  return screen.getAllByRole("button", { name: "More options for Metacam" });
}

async function openEditSheet(user: ReturnType<typeof userEvent.setup>, index: number) {
  await user.click(overflowTriggers()[index]);
  await user.click(await screen.findByRole("menuitem", { name: "Edit time" }));
  return screen.findByTestId("edit-dose-time-headline");
}

function saveButton(): HTMLElement {
  return within(sheet()).getByRole("button", { name: /^Save \d\d:\d\d$/ });
}

function sheetButton(name: string): HTMLElement {
  return within(sheet()).getByRole("button", { name });
}

describe("editing a past dose's time", () => {
  it("offers the overflow on given doses only", async () => {
    const repo = createMemoryRepo();
    const pet = await withClock(FIXTURE_NOW, () => repo.createPet({ name: "Clover", species: "rabbit" }));
    const medication = await withClock(FIXTURE_NOW, () =>
      repo.createMedication({ name: "Metacam", form: "liquid", unit: "ml" }),
    );
    const course = await withClock(at(YESTERDAY, "05:00").toISOString(), () =>
      repo.createCourse({
        petId: pet.id,
        medicationId: medication.id,
        doseAmount: 0.4,
        doseUnit: "ml",
        instructions: null,
        schedule: { kind: "fixedTimes", times: ["08:00", "20:00"] },
        startDate: YESTERDAY,
        endDate: null,
        notes: null,
      }),
    );
    const givenIso = at(YESTERDAY, "08:05").toISOString();
    await withClock(givenIso, () =>
      repo.logDose({ courseId: course.id, status: "given", scheduledFor: at(YESTERDAY, "08:00").toISOString(), givenAt: givenIso, amount: 0.4 }),
    );
    const skippedIso = at(YESTERDAY, "20:00").toISOString();
    await withClock(skippedIso, () =>
      repo.logDose({ courseId: course.id, status: "skipped", scheduledFor: skippedIso, givenAt: skippedIso, amount: 0.4 }),
    );

    renderWithProviders(<HistoryView petId={pet.id} />, { repo });
    await screen.findByText("History");
    await screen.findAllByText(/^by /);

    // Three rows (course started, given, skipped) — one overflow.
    expect(overflowTriggers()).toHaveLength(1);
  });

  it("moves an earlier dose without shifting the chain", async () => {
    const { repo, petId, course } = await seedChain();
    const before = await nextDueFromRepo(repo, course, at(YESTERDAY, "00:00"));
    expect(before).toEqual(at(TODAY, "00:00"));

    renderWithProviders(<HistoryView petId={petId} />, { repo });
    const user = userEvent.setup();
    await screen.findByText("History");
    await screen.findAllByText(/^by /);

    // Index 1: the 06:00 dose, the older of the two given rows.
    const headline = await openEditSheet(user, 1);
    expect(headline).toHaveTextContent("06:00");
    expect(within(sheet()).getByText("Nothing else moves")).toBeInTheDocument();
    // The helper names the dose it cannot cross, which is *why* nothing shifts.
    expect(
      within(sheet()).getByText("Anything before the next dose at 16:00."),
    ).toBeInTheDocument();

    await user.click(sheetButton(`${MINUS} 5 min`));
    expect(headline).toHaveTextContent("05:55");
    await user.click(saveButton());

    await waitFor(async () => {
      expect(await liveGivenTimes(repo, course.id)).toEqual(["05:55", "16:00"]);
    });
    // THE CLAIM: the chain still counts from 16:00 and has not moved.
    expect(await nextDueFromRepo(repo, course, at(YESTERDAY, "00:00"))).toEqual(before);
  });

  it("shifts the chain when the LAST dose is moved, and says so before saving", async () => {
    const { repo, petId, course } = await seedChain();

    renderWithProviders(<HistoryView petId={petId} />, { repo });
    const user = userEvent.setup();
    await screen.findByText("History");
    await screen.findAllByText(/^by /);

    // Index 0: the 16:00 dose, the newest — the chain's anchor.
    const headline = await openEditSheet(user, 0);
    expect(headline).toHaveTextContent("16:00");

    await user.click(sheetButton(`${MINUS} 1 h`));
    expect(headline).toHaveTextContent("15:00");
    // Stated before committing (SPEC §6.1a's consequence block, same idea).
    expect(within(sheet()).getByText(/^Next dose moves to/)).toBeInTheDocument();

    await user.click(saveButton());

    await waitFor(async () => {
      expect(await liveGivenTimes(repo, course.id)).toEqual(["06:00", "15:00"]);
    });
    // 15:00 + 8h — an hour earlier than the 00:00 it was heading for.
    expect(await nextDueFromRepo(repo, course, at(YESTERDAY, "00:00"))).toEqual(
      at(YESTERDAY, "23:00"),
    );
  });

  it("cannot move a dose past the one after it", async () => {
    const { repo, petId, course } = await seedChain();
    // A third dose 100 minutes after the first — clear of the 90-minute
    // interval dedup guard, and close enough that the stepper reaches the
    // ceiling in a handful of presses rather than a hundred.
    const closeIso = at(YESTERDAY, "07:40").toISOString();
    await withClock(closeIso, () =>
      repo.logDose({ courseId: course.id, status: "given", scheduledFor: null, givenAt: closeIso, amount: 0.4 }),
    );

    renderWithProviders(<HistoryView petId={petId} />, { repo });
    const user = userEvent.setup();
    await screen.findByText("History");
    await screen.findAllByText(/^by /);

    // Rows are newest first: 16:00, 07:40, 06:00 — index 2 is the 06:00 dose,
    // whose next neighbour is now 07:40.
    const headline = await openEditSheet(user, 2);
    await user.click(sheetButton("+ 1 h"));
    expect(headline).toHaveTextContent("07:00");

    for (let i = 0; i < 20; i++) {
      const later = sheetButton("+ 5 min");
      if ((later as HTMLButtonElement).disabled) break;
      await user.click(later);
    }
    // Clamped a minute short of the dose after it, never past it.
    expect(headline).toHaveTextContent("07:39");
    expect(sheetButton("+ 5 min")).toBeDisabled();
  });

  it("shows the corrected time on the row, and says the time was edited", async () => {
    const { repo, petId } = await seedChain();

    renderWithProviders(<HistoryView petId={petId} />, { repo });
    const user = userEvent.setup();
    await screen.findByText("History");
    const rowsBefore = await screen.findAllByText(/^by /);

    await openEditSheet(user, 1);
    await user.click(sheetButton(`${MINUS} 1 h`));
    await user.click(saveButton());

    await screen.findByText(/time edited from 06:00/);
    // The row now reads 05:00 — and the old 06:00 is gone from the time column
    // rather than lingering as a second row for the same dose.
    expect(screen.getByText("05:00")).toBeInTheDocument();
    expect(screen.queryByText("06:00")).not.toBeInTheDocument();
    // One row per dose still: the superseded original is not a second entry.
    expect(screen.getAllByText(/^by /)).toHaveLength(rowsBefore.length);
  });
});
