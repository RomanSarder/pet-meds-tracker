// The Today dashboard's integration tests: the whole screen, the real repo,
// the real query client, the real toast, and a router — driven only through
// the DOM a user can actually touch.
//
// THE GOVERNING PRODUCT RULE (SPEC §5.1): "Give logs the dose at the current
// time. The row animates to its given state in place. The tap must not
// navigate."
//
// WHY EVERY LOGGING TEST READS THE PATHNAME. `renderWithProviders` mounts the
// page under a catch-all `$` route, so the component stays mounted whatever
// the location is. A navigation is therefore *invisible* to every DOM query in
// this file — the card, the rows and the toast all look exactly the same on
// `/today` as on `/pets/…`. The `LocationProbe` below is the only thing that
// can see it, so every test that logs, skips, starts a course or drives the
// dialog asserts the path is still `/today` afterwards. Two tests navigate on
// purpose (card-body tap → Pet detail, menu *Open course* → the course), which
// is what keeps the probe demonstrably capable of changing and the "unchanged"
// assertions non-vacuous.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { useRouterState } from "@tanstack/react-router";
import type {
  Course,
  DoseEvent,
  FixtureData,
  LocalDate,
  Medication,
  Pet,
} from "@/domain";
import { cloneFixtures, FIXTURE_NOW, occurrenceKeyFor } from "@/domain";
import type { Occurrence } from "@/engine";
import type { Repo } from "@/data/repo.types";
import { createMemoryRepo } from "@/data/memoryRepo";
import { renderWithProviders, userEvent } from "@/test/renderWithProviders";
import {
  engineStore,
  makeOccurrence,
  resetEngineStore,
  setOccurrences,
  setState,
} from "./testEngine";
import { TodayPage } from "./TodayPage";

// The engine is a typed stub on this branch (see testEngine.ts): unmocked,
// `getOccurrences` returns nothing usable and `getDoseState` answers
// "upcoming" for everything, so no card would ever render and every assertion
// below would pass or fail for the wrong reason.
vi.mock("@/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/engine")>();
  const { engineDouble } = await import("./testEngine");
  return { ...actual, ...engineDouble };
});

// jsdom implements neither, and Base UI's menu popup reaches for both.
// Copied from TodayDoseRow.test.tsx rather than added to the shared
// `src/test/setup.ts`, which another slice owns.
const patchable = window as unknown as { ResizeObserver?: typeof ResizeObserver };
patchable.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};

/** The local day of FIXTURE_NOW (08:00 BST, Saturday). */
const DAY: LocalDate = "2026-08-08";
/** 08:00 BST today — Clover's Metacam morning dose, left unlogged by the fixtures. */
const AT_0800 = "2026-08-08T07:00:00.000Z";
/** 09:00 BST today — Nugget's Vitamin C dose. */
const AT_0900 = "2026-08-08T08:00:00.000Z";
/** 07:00 BST today — the Saturday Ivermectin dose the fixtures already logged. */
const AT_0700 = "2026-08-08T06:00:00.000Z";

// --- household helpers -----------------------------------------------------
// Everything is looked up by shape (pet name, medication name, course status)
// rather than by a hard-coded fixture id, so a reordered or renumbered fixture
// file fails loudly here instead of quietly testing the wrong course.

function petNamed(data: FixtureData, name: string): Pet {
  const pet = data.pets.find((p) => p.name === name);
  if (!pet) throw new Error(`fixture drift: no pet named ${name}`);
  return pet;
}

function medicationNamed(data: FixtureData, name: string): Medication {
  const med = data.medications.find((m) => m.name === name);
  if (!med) throw new Error(`fixture drift: no medication named ${name}`);
  return med;
}

function courseOf(data: FixtureData, petName: string, medName: string): Course {
  const pet = petNamed(data, petName);
  const med = medicationNamed(data, medName);
  const course = data.courses.find(
    (c) => c.petId === pet.id && c.medicationId === med.id && c.status === "active",
  );
  if (!course) {
    throw new Error(`fixture drift: no active ${medName} course for ${petName}`);
  }
  return course;
}

interface Household {
  data: FixtureData;
  repo: Repo;
}

function household(): Household {
  const data = cloneFixtures();
  return { data, repo: createMemoryRepo(data) };
}

/**
 * Registers the day's occurrences with the engine double, joined to the repo's
 * live dose events — and keeps them joined across writes.
 *
 * WHY THE JOIN IS HERE. The real engine reads `ctx.events` and hangs each
 * occurrence's live `DoseEvent` off it (see `getOccurrences` in `@/engine`).
 * The double deliberately does not: it is a lookup table that hands back
 * exactly the array the test registered. Without this wrapper, the refetch
 * `useLogDose.onSettled` triggers would return a stale, event-less occurrence
 * and every logged row would silently flip back — a defect in the test double,
 * not in the screen. So the test supplies the join the engine would.
 */
async function register(repo: Repo, occurrences: Occurrence[]): Promise<void> {
  const rejoin = async (): Promise<void> => {
    const events = await repo.listDoseEvents({});
    setOccurrences(
      DAY,
      occurrences.map((occurrence) => ({
        ...occurrence,
        event:
          events.find(
            (e) => e.occurrenceKey === occurrence.key && e.deletedAt === null,
          ) ?? null,
      })),
    );
  };

  const realLogDose = repo.logDose.bind(repo);
  repo.logDose = async (input) => {
    const event = await realLogDose(input);
    await rejoin();
    return event;
  };

  const realRetract = repo.retractDoseEvent.bind(repo);
  repo.retractDoseEvent = async (id) => {
    await realRetract(id);
    await rejoin();
  };

  await rejoin();
}

// --- render harness --------------------------------------------------------

/**
 * The harness's router is a catch-all and does not hand the test its router
 * instance, so the current path is read back out of the tree instead.
 */
function LocationProbe() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return <span data-testid="pathname">{pathname}</span>;
}

function renderToday(repo: Repo, now?: string) {
  return renderWithProviders(
    <>
      <TodayPage />
      <LocationProbe />
    </>,
    { repo, route: "/today", now },
  );
}

function pathname(): string {
  return screen.getByTestId("pathname").textContent ?? "";
}

/** Resolves once the screen has painted a real card for `petName`. */
function cardFor(petName: string): Promise<HTMLElement> {
  return screen.findByRole("button", { name: `Open ${petName}` });
}

/** The `DoseEvent`s in `after` that were not in `before`. */
function newEvents(before: DoseEvent[], after: DoseEvent[]): DoseEvent[] {
  return after.filter((a) => !before.some((b) => b.id === a.id));
}

beforeEach(() => {
  resetEngineStore();
});

describe("TodayPage", () => {
  it("orders the cards overdue pet, pending pet, done pet, and collapses the done one", async () => {
    const { data, repo } = household();
    const cloverMetacam = courseOf(data, "Clover", "Metacam");
    const nuggetVitaminC = courseOf(data, "Nugget", "Vitamin C");
    const biscuitIvermectin = courseOf(data, "Biscuit", "Ivermectin");

    const overdue = makeOccurrence(cloverMetacam, {
      day: DAY,
      scheduledFor: AT_0800,
    });
    const pending = makeOccurrence(nuggetVitaminC, {
      day: DAY,
      scheduledFor: AT_0900,
    });
    // No state registered for this one: the join hangs the fixtures' own
    // 07:12 `given` event off it, and the double reads `given` back from that.
    const done = makeOccurrence(biscuitIvermectin, {
      day: DAY,
      scheduledFor: AT_0700,
    });
    // Registered in the wrong order deliberately: the ordering under test is
    // the view model's, not the engine's iteration order.
    await register(repo, [done, pending, overdue]);
    setState(overdue.key, "overdue");
    setState(pending.key, "later");

    renderToday(repo);
    await cardFor("Clover");

    const cards = screen.getAllByRole("button", { name: /^Open / });
    expect(cards.map((c) => c.getAttribute("aria-label"))).toEqual([
      "Open Clover",
      "Open Nugget",
      "Open Biscuit",
    ]);

    // SPEC §9: the overdue card carries the word, not merely the tint.
    expect(within(cards[0]).getByText("Overdue since 08:00")).toBeInTheDocument();
    expect(within(cards[0]).getByRole("button", { name: "Give" })).toBeInTheDocument();
    expect(within(cards[1]).getByText("Next at 09:00")).toBeInTheDocument();

    // The collapsed, greyed variant: a status line and a check, no dose rows.
    const biscuit = cards[2];
    expect(within(biscuit).getByText("All done · Ivermectin at 07:12")).toBeInTheDocument();
    expect(within(biscuit).getByRole("img", { name: "check" })).toBeInTheDocument();
    expect(within(biscuit).queryByRole("button", { name: "Give" })).toBeNull();
    expect(within(biscuit).queryByRole("group")).toBeNull();
  });

  // SPEC §5.1 cuts the greeting at 12:00 and 18:00; both sides of both cuts.
  const GREETINGS: Array<{ now: string; local: string; greeting: string }> = [
    { now: "2026-08-08T10:59:00.000Z", local: "11:59", greeting: "Good morning" },
    { now: "2026-08-08T11:00:00.000Z", local: "12:00", greeting: "Good afternoon" },
    { now: "2026-08-08T16:59:00.000Z", local: "17:59", greeting: "Good afternoon" },
    { now: "2026-08-08T17:00:00.000Z", local: "18:00", greeting: "Good evening" },
  ];

  for (const { now, local, greeting } of GREETINGS) {
    it(`greets "${greeting}" at ${local} local`, async () => {
      const { repo } = household();
      await register(repo, []);

      renderToday(repo, now);

      expect(await screen.findByText(greeting)).toBeInTheDocument();
      for (const other of ["Good morning", "Good afternoon", "Good evening"]) {
        if (other === greeting) continue;
        expect(screen.queryByText(other)).toBeNull();
      }
    });
  }

  it("appends the overdue clause to the subtitle when a dose is overdue", async () => {
    const { data, repo } = household();
    const overdue = makeOccurrence(courseOf(data, "Clover", "Metacam"), {
      day: DAY,
      scheduledFor: AT_0800,
    });
    const later = makeOccurrence(courseOf(data, "Nugget", "Vitamin C"), {
      day: DAY,
      scheduledFor: AT_0900,
    });
    await register(repo, [overdue, later]);
    setState(overdue.key, "overdue");
    setState(later.key, "later");

    renderToday(repo);

    const subtitle = await screen.findByText(/doses? left today/);
    expect(subtitle).toHaveTextContent("· 1 overdue");
  });

  it("drops the overdue clause entirely when nothing is overdue", async () => {
    const { data, repo } = household();
    const later = makeOccurrence(courseOf(data, "Nugget", "Vitamin C"), {
      day: DAY,
      scheduledFor: AT_0900,
    });
    await register(repo, [later]);
    setState(later.key, "later");

    renderToday(repo);

    const subtitle = await screen.findByText(/doses? left today/);
    expect(subtitle.textContent).toBe("1 dose left today");
    expect(screen.queryByText(/overdue/i)).toBeNull();
  });

  it("logs a dose in one tap without leaving the dashboard", async () => {
    const user = userEvent.setup();
    const { data, repo } = household();
    const course = courseOf(data, "Clover", "Metacam");
    const occurrence = makeOccurrence(course, { day: DAY, scheduledFor: AT_0800 });
    await register(repo, [occurrence]);
    setState(occurrence.key, "due");

    renderToday(repo);
    const card = await cardFor("Clover");
    expect(within(card).getByText("0 of 1 today")).toBeInTheDocument();

    const before = pathname();
    expect(before).toBe("/today");

    await user.click(within(card).getByRole("button", { name: "Give" }));

    // The row is still there, in its given presentation — not removed, not
    // replaced by a spinner, not behind a navigation.
    expect(
      await screen.findByRole("group", { name: "Metacam 0.4 ml, given" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Give" })).toBeNull();

    await waitFor(() => {
      expect(
        within(screen.getByRole("button", { name: "Open Clover" })).getByText("1 of 1 today"),
      ).toBeInTheDocument();
    });

    expect(pathname()).toBe(before);
  });

  it("leaves dose history and stock exactly as they were after log-then-undo", async () => {
    const user = userEvent.setup();
    const { data, repo } = household();
    const course = courseOf(data, "Clover", "Metacam");
    const occurrence = makeOccurrence(course, { day: DAY, scheduledFor: AT_0800 });
    await register(repo, [occurrence]);
    setState(occurrence.key, "due");

    const eventsBefore = await repo.listDoseEvents({});
    const medicationsBefore = await repo.listMedications();
    // `listDoseEvents` hides `deletedAt !== null` rows (memoryRepo.ts:285), so
    // it cannot tell a hard delete from a tombstone. `exportHousehold` copies
    // the dose-event array raw, so it can.
    const backupBefore = (await repo.exportHousehold()).doseEvents;

    renderToday(repo);
    const card = await cardFor("Clover");
    expect(pathname()).toBe("/today");
    await user.click(within(card).getByRole("button", { name: "Give" }));

    // The log really landed, so the undo below is undoing something.
    await waitFor(async () => {
      expect(await repo.listDoseEvents({})).toHaveLength(eventsBefore.length + 1);
    });

    const toast = await screen.findByRole("status");
    await user.click(within(toast).getByRole("button", { name: "Undo" }));

    await waitFor(async () => {
      expect(await repo.listDoseEvents({})).toHaveLength(eventsBefore.length);
    });

    // SPEC §11: "logging then undoing a dose leaves history exactly as before,
    // and never touches stock" — asserted as data, never by reading the UI.
    expect(await repo.listDoseEvents({})).toEqual(eventsBefore);

    // The unfiltered view, and the reason "exactly as before" means a HARD
    // delete rather than a hidden tombstone: a soft-deleted row would vanish
    // from `listDoseEvents` above and still be sitting here.
    expect((await repo.exportHousehold()).doseEvents).toEqual(backupBefore);

    const medicationsAfter = await repo.listMedications();
    expect(medicationsAfter.map((m) => m.stockUnits)).toEqual(
      medicationsBefore.map((m) => m.stockUnits),
    );
    expect(medicationsAfter).toEqual(medicationsBefore);

    // Neither the log nor the undo is allowed to leave the dashboard.
    expect(pathname()).toBe("/today");
  });

  it("logs exactly the earliest overdue dose from the banner", async () => {
    const user = userEvent.setup();
    const { data, repo } = household();
    const cloverMetacam = courseOf(data, "Clover", "Metacam");
    const nuggetVitaminC = courseOf(data, "Nugget", "Vitamin C");

    const earliest = makeOccurrence(cloverMetacam, { day: DAY, scheduledFor: AT_0800 });
    const laterOverdue = makeOccurrence(nuggetVitaminC, { day: DAY, scheduledFor: AT_0900 });
    await register(repo, [laterOverdue, earliest]);
    setState(earliest.key, "overdue");
    setState(laterOverdue.key, "overdue");

    const before = await repo.listDoseEvents({});
    renderToday(repo);

    expect(await screen.findByText("2 doses overdue")).toBeInTheDocument();
    expect(screen.getByText("Clover · Metacam, 08:00")).toBeInTheDocument();
    expect(pathname()).toBe("/today");

    await user.click(screen.getByRole("button", { name: "Log" }));

    await waitFor(async () => {
      expect(await repo.listDoseEvents({})).toHaveLength(before.length + 1);
    });

    const created = newEvents(before, await repo.listDoseEvents({}));
    expect(created).toHaveLength(1);
    expect(created[0].courseId).toBe(cloverMetacam.id);
    expect(created[0].occurrenceKey).toBe(earliest.key);
    expect(created[0].status).toBe("given");

    expect(pathname()).toBe("/today");
  });

  it("renders a skipped dose at 55% opacity with 'Skipped' where the time goes", async () => {
    const user = userEvent.setup();
    const { data, repo } = household();
    const occurrence = makeOccurrence(courseOf(data, "Clover", "Metacam"), {
      day: DAY,
      scheduledFor: AT_0800,
    });
    await register(repo, [occurrence]);
    setState(occurrence.key, "due");

    renderToday(repo);
    await cardFor("Clover");
    expect(pathname()).toBe("/today");

    await user.click(screen.getByRole("button", { name: /more options/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Skip this dose" }));

    const row = await screen.findByRole("group", { name: "Metacam 0.4 ml, skipped" });
    const skipped = within(row).getByText("Skipped");
    expect(skipped.parentElement).toHaveStyle({ opacity: "0.55" });
    expect(within(row).queryByText("08:00")).toBeNull();

    // Skipping is a log, and a log never leaves the dashboard. Without this the
    // dose is skipped correctly *and* the app is sitting on Pet detail, which
    // every other assertion in this test is blind to.
    expect(pathname()).toBe("/today");
  });

  it("opens the course — and only the course — from the menu's Open course", async () => {
    const user = userEvent.setup();
    const { data, repo } = household();
    const course = courseOf(data, "Clover", "Metacam");
    const occurrence = makeOccurrence(course, { day: DAY, scheduledFor: AT_0800 });
    await register(repo, [occurrence]);
    setState(occurrence.key, "due");

    renderToday(repo);
    await cardFor("Clover");
    expect(pathname()).toBe("/today");

    await user.click(screen.getByRole("button", { name: /more options/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Open course" }));

    // The one menu item that is allowed to route. If the click also reaches the
    // card wrapper, two navigations fire and the wrapper's lands last — so the
    // user ends up on Pet detail and this pathname is the only witness.
    await waitFor(() => {
      expect(pathname()).toBe(`/courses/${course.id}`);
    });
  });

  it("logs at a different time through the dialog without leaving the dashboard", async () => {
    const user = userEvent.setup();
    const { data, repo } = household();
    const course = courseOf(data, "Clover", "Metacam");
    const occurrence = makeOccurrence(course, { day: DAY, scheduledFor: AT_0800 });
    await register(repo, [occurrence]);
    setState(occurrence.key, "due");

    const before = await repo.listDoseEvents({});
    renderToday(repo);
    await cardFor("Clover");
    expect(pathname()).toBe("/today");

    await user.click(screen.getByRole("button", { name: /more options/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Log at a different time" }));

    // Every step of the dialog is a click inside a portal that is a React child
    // of the card wrapper, so each one is checked, not just the last.
    await screen.findByRole("dialog");
    expect(pathname()).toBe("/today");

    const input = screen.getByLabelText("Time given");
    await user.clear(input);
    await user.type(input, "09:15");
    expect(pathname()).toBe("/today");

    await user.click(screen.getByRole("button", { name: "Log" }));

    await waitFor(async () => {
      expect(await repo.listDoseEvents({})).toHaveLength(before.length + 1);
    });

    const created = newEvents(before, await repo.listDoseEvents({}));
    expect(created).toHaveLength(1);
    expect(created[0].status).toBe("given");
    expect(new Date(created[0].givenAt).getHours()).toBe(9);
    expect(new Date(created[0].givenAt).getMinutes()).toBe(15);

    expect(pathname()).toBe("/today");
  });

  it("cancels the dialog without logging and without leaving the dashboard", async () => {
    const user = userEvent.setup();
    const { data, repo } = household();
    const occurrence = makeOccurrence(courseOf(data, "Clover", "Metacam"), {
      day: DAY,
      scheduledFor: AT_0800,
    });
    await register(repo, [occurrence]);
    setState(occurrence.key, "due");

    const before = await repo.listDoseEvents({});
    renderToday(repo);
    await cardFor("Clover");

    await user.click(screen.getByRole("button", { name: /more options/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Log at a different time" }));
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await repo.listDoseEvents({})).toEqual(before);
    expect(pathname()).toBe("/today");
  });

  it("offers Start course for a never-started interval course and logs it now", async () => {
    const user = userEvent.setup();
    const { data, repo } = household();
    const course = data.courses.find(
      (c) =>
        c.status === "active" &&
        c.schedule.kind === "fromLastDose" &&
        !data.doseEvents.some((e) => e.courseId === c.id && e.status === "given"),
    );
    if (!course) throw new Error("fixture drift: no never-started fromLastDose course");

    // No due instant: a chain with no anchor. Key and `scheduledFor` are both
    // null-derived, which is exactly the agreement the log path relies on.
    const occurrence = makeOccurrence(course, { day: DAY, scheduledFor: null });
    await register(repo, [occurrence]);
    setState(occurrence.key, "notStarted");

    renderToday(repo);

    // The row's own detail line, not the card status that also reads
    // "Not started" — SPEC §3b wants the phrase on the dose itself.
    expect(await screen.findByText(/^Not started ·/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Give" })).toBeNull();
    expect(pathname()).toBe("/today");

    await user.click(screen.getByRole("button", { name: "Start course" }));

    await waitFor(async () => {
      expect(await repo.listDoseEvents({ courseId: course.id })).toHaveLength(1);
    });

    const [created] = await repo.listDoseEvents({ courseId: course.id });
    expect(created.status).toBe("given");
    expect(created.scheduledFor).toBeNull();
    // The injected clock, not a wall-clock read (SPEC §9).
    expect(created.givenAt).toBe(FIXTURE_NOW);
    expect(created.occurrenceKey).toBe(occurrence.key);

    expect(pathname()).toBe("/today");
  });

  it("shows the empty state with the next due time when nothing is pending", async () => {
    const { repo } = household();
    await register(repo, []);
    engineStore.nextDue = new Date("2026-08-08T19:00:00.000Z"); // 20:00 BST

    renderToday(repo);

    expect(await screen.findByText("Nothing due today.")).toBeInTheDocument();
    expect(screen.getByText("Next dose at 20:00")).toBeInTheDocument();
  });

  it("writes an occurrence key that round-trips from the courseId and scheduledFor it logged", async () => {
    const user = userEvent.setup();
    const { data, repo } = household();
    const course = courseOf(data, "Clover", "Metacam");
    const occurrence = makeOccurrence(course, { day: DAY, scheduledFor: AT_0800 });
    await register(repo, [occurrence]);
    setState(occurrence.key, "due");

    const before = await repo.listDoseEvents({});
    renderToday(repo);
    const card = await cardFor("Clover");
    await user.click(within(card).getByRole("button", { name: "Give" }));

    await waitFor(async () => {
      expect(await repo.listDoseEvents({})).toHaveLength(before.length + 1);
    });

    const created = newEvents(before, await repo.listDoseEvents({}));
    expect(created).toHaveLength(1);
    // The repo derives the stored key from the `courseId`/`scheduledFor` the
    // page handed it, so this holds only if those two agreed with the key the
    // optimistic flip matched on. Disagree, and the flip misses the cached
    // occurrence and the missed-dose sweep loses its idempotence.
    expect(created[0].occurrenceKey).toBe(occurrence.key);
    expect(occurrenceKeyFor(created[0].courseId, created[0].scheduledFor)).toBe(
      occurrence.key,
    );

    expect(pathname()).toBe("/today");
  });

  it("opens Pet detail when the card body is tapped", async () => {
    const user = userEvent.setup();
    const { data, repo } = household();
    const clover = petNamed(data, "Clover");
    const occurrence = makeOccurrence(courseOf(data, "Clover", "Metacam"), {
      day: DAY,
      scheduledFor: AT_0800,
    });
    await register(repo, [occurrence]);
    setState(occurrence.key, "due");

    renderToday(repo);
    const card = await cardFor("Clover");
    expect(pathname()).toBe("/today");

    await user.click(card);

    await waitFor(() => {
      expect(pathname()).toBe(`/pets/${clover.id}`);
    });
  });
});
