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
/** 30 minutes before `FIXTURE_NOW` (07:00 UTC = 08:00 BST) — inside the 60-minute fixedTimes grace window. */
const CONFLICTING_GIVEN_AT = "2026-08-08T06:30:00.000Z";
/**
 * 45 minutes after `FIXTURE_NOW` (07:45 UTC = 08:45 BST), same local day as
 * `DAY`. F7: `AT_0800` literally EQUALS `FIXTURE_NOW`, so a `later`-state
 * occurrence built on it is a state the REAL engine could never produce for
 * that `scheduledFor` — `getDoseState` would call it `due` (`now >= dueAt`).
 * This constant sits far enough past `DUE_PRE_WINDOW_MIN` (30 min) that the
 * real engine genuinely classifies it `later`: the early-give dialog tests
 * below use this instead of `AT_0800`, so their hand-fed `setState(...,
 * "later")` matches what real classification would actually produce.
 */
const LATER_TODAY = "2026-08-08T07:45:00.000Z";

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

/** The fixtures' second household member — picked by name, not by a hard-coded id. */
function martaOf(data: FixtureData): { id: string } {
  const marta = data.users.find((u) => u.displayName === "Marta");
  if (!marta) throw new Error("fixture drift: no Marta member");
  return marta;
}

/** THIS device's own member — picked by `isSelf`, not by name (the fixture's self user is "Roman"). */
function selfOf(data: FixtureData): { id: string } {
  const self = data.users.find((u) => u.isSelf);
  if (!self) throw new Error("fixture drift: no isSelf member");
  return self;
}

/**
 * Inserts a live `DoseEvent` for `course`, attributed to someone other than
 * the signed-in device, without going through `logDose` — which always
 * stamps THIS device's own `currentActorId()` and could never produce an
 * event Marta logged. `applyRemoteChanges` is the repo's own ledger-insert
 * path (what W9 sync uses), so this is a real row `logDose`'s dedup guard
 * will see, not a hand-rolled test-only shortcut.
 */
async function seedConflictingEvent(
  repo: Repo,
  course: Course,
  opts: { actorId: string; status: "given" | "skipped"; givenAt: string },
): Promise<void> {
  await repo.applyRemoteChanges({
    doseEvents: [
      {
        id: `conflict-${opts.status}`,
        courseId: course.id,
        scheduledFor: opts.givenAt,
        status: opts.status,
        loggedAt: opts.givenAt,
        givenAt: opts.givenAt,
        amount: course.doseAmount,
        note: null,
        occurrenceKey: occurrenceKeyFor(course.id, opts.givenAt),
        supersedesId: null,
        actorId: opts.actorId,
        createdAt: opts.givenAt,
        updatedAt: opts.givenAt,
        deletedAt: null,
      },
    ],
  });
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
    expect(within(cards[1]).getByText("Next dose at 09:00")).toBeInTheDocument();

    // The collapsed, greyed variant: a status line and a check, no dose rows.
    const biscuit = cards[2];
    expect(within(biscuit).getByText("All done · Ivermectin at 07:12")).toBeInTheDocument();
    // The checkmark is PAINTED but SILENT. It used to be findable as
    // `getByRole("img", { name: "check" })`; localization made that wrong —
    // the glyph is purely decorative, so `PetCard` now passes `aria-hidden`
    // and it no longer announces the raw English token "check" in the middle
    // of an otherwise Ukrainian screen (I18N-DESIGN.md ADDENDUM A3). Both
    // halves are asserted: it is still drawn, and it is no longer named.
    expect(biscuit.querySelector('[aria-hidden="true"] > svg.lucide-check')).not.toBeNull();
    expect(within(biscuit).queryByRole("img", { name: "check" })).toBeNull();
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

  it("logs a not-yet-due (later) dose normally when nothing conflicts", async () => {
    const user = userEvent.setup();
    const { data, repo } = household();
    const course = courseOf(data, "Clover", "Metacam");
    const occurrence = makeOccurrence(course, { day: DAY, scheduledFor: AT_0800 });
    await register(repo, [occurrence]);
    setState(occurrence.key, "later");

    const before = await repo.listDoseEvents({});
    renderToday(repo);
    const card = await cardFor("Clover");
    expect(pathname()).toBe("/today");

    await user.click(within(card).getByRole("button", { name: "Give" }));

    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent("Metacam logged");
    expect(within(toast).getByRole("button", { name: "Undo" })).toBeInTheDocument();

    await waitFor(async () => {
      expect(await repo.listDoseEvents({})).toHaveLength(before.length + 1);
    });
    const created = newEvents(before, await repo.listDoseEvents({}));
    expect(created).toHaveLength(1);
    expect(created[0].status).toBe("given");
    // The injected clock, not a wall-clock read (SPEC §9) — Give logs "now".
    expect(created[0].givenAt).toBe(FIXTURE_NOW);

    expect(pathname()).toBe("/today");
  });

  // UI-WIRING COVERAGE ONLY — NOT proof of the occurrence-generation fix.
  // This file `vi.mock`s `@/engine` (see the top of the file): `getOccurrences`
  // here is `testEngine.ts`'s lookup table, driven entirely by
  // `setOccurrences`/`setState` below. Reverting `occurrences.ts` wholesale
  // would leave this test green, because the "upcoming" occurrence and its
  // state are handed in by the test, not produced by the real engine. What
  // this test DOES prove, for real: given an "upcoming" `fromLastDose` dose
  // in the snapshot, the screen renders it correctly (day-qualified, not as
  // due now) AND its Give button actually writes — SPEC §5.1's real
  // `logDose` call, real toast, real event, `givenAt` at "now" (which is what
  // re-anchors the chain from the actual given time, SPEC §3b). The claim
  // that the engine itself emits this occurrence early is `occurrences.ts`'s
  // — see `engine/occurrences.test.ts`'s "SPEC §3b" cases, which run against
  // the real, unmocked `getOccurrences`/`anchorFor`.
  it("UI wiring: an 'upcoming' fromLastDose dose renders day-qualified and its Give button logs it", async () => {
    const user = userEvent.setup();
    const { data, repo } = household();
    const course = courseOf(data, "Clover", "Metoclopramide");
    const tomorrow = "2026-08-09";
    const occurrence = makeOccurrence(course, {
      day: DAY,
      scheduledFor: `${tomorrow}T02:00:00.000Z`,
    });
    await register(repo, [occurrence]);
    setState(occurrence.key, "upcoming");

    const before = await repo.listDoseEvents({});
    renderToday(repo);
    const card = await cardFor("Clover");
    expect(pathname()).toBe("/today");

    // Reachable: the row exists and reads as due tomorrow, not now — both in
    // the card's status line and the row's own detail line. (02:00 UTC = 03:00 BST.)
    expect(within(card).getByText("Next dose tomorrow at 03:00")).toBeInTheDocument();
    expect(within(card).getByText(/^03:00 · tomorrow · /)).toBeInTheDocument();
    const giveButton = within(card).getByRole("button", { name: "Give" });
    expect(giveButton).toBeInTheDocument();

    await user.click(giveButton);

    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent("Metoclopramide logged");

    await waitFor(async () => {
      expect(await repo.listDoseEvents({})).toHaveLength(before.length + 1);
    });
    const created = newEvents(before, await repo.listDoseEvents({}));
    expect(created).toHaveLength(1);
    expect(created[0].status).toBe("given");
    // Given early: logged at "now" (SPEC §5.1), not at the planned due
    // instant — which is exactly what re-anchors the chain from the actual
    // given time (SPEC §3b), not the original schedule.
    expect(created[0].givenAt).toBe(FIXTURE_NOW);

    expect(pathname()).toBe("/today");
  });

  // SPEC §5 / §3b: "Two people logging the same dose within the grace window
  // produce one DoseEvent" used to be a FLAT rejection for every collision,
  // including this one — the exact repro from the bug report ("a little
  // popup said someone already gave it... nothing else happened"). The
  // product decision is "allow, but confirm when early": a dose that is not
  // yet due (`later`/`upcoming`) now asks for confirmation instead, naming
  // who logged the prior dose and when. It must stay actionable either way —
  // never a silent no-op, and never a silent write either.
  it("offers an early-give confirm dialog on a duplicate Give for a later (not-yet-due) dose, and cancelling changes nothing", async () => {
    const user = userEvent.setup();
    const { data, repo } = household();
    const course = courseOf(data, "Clover", "Metacam");
    const occurrence = makeOccurrence(course, { day: DAY, scheduledFor: LATER_TODAY });
    await register(repo, [occurrence]);
    setState(occurrence.key, "later");

    const marta = martaOf(data);
    await seedConflictingEvent(repo, course, {
      actorId: marta.id,
      status: "given",
      givenAt: CONFLICTING_GIVEN_AT,
    });

    const before = await repo.listDoseEvents({});
    renderToday(repo);
    const card = await cardFor("Clover");
    expect(pathname()).toBe("/today");

    await user.click(within(card).getByRole("button", { name: "Give" }));

    // F4: dedicated dialog copy, not the flat-rejection toast's "Already
    // given..." reused verbatim — states the gap since the last dose
    // (FIXTURE_NOW 07:00 minus CONFLICTING_GIVEN_AT 06:30 = 30 min) and how
    // far ahead of due this give would land (LATER_TODAY 07:45 minus
    // FIXTURE_NOW 07:00 = 45 min), not a wall-clock time to subtract.
    expect(await screen.findByText("Give Metacam early?")).toBeInTheDocument();
    expect(
      screen.getByText("Marta gave the last dose 30 min ago. This one isn't due for another 45 min."),
    ).toBeInTheDocument();
    expect(await repo.listDoseEvents({})).toEqual(before);

    // Cancelling logs nothing: no event written, the dialog withdraws, the
    // row stays actionable, and the tap never left Today.
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByText("Give Metacam early?")).not.toBeInTheDocument();
    });
    expect(await repo.listDoseEvents({})).toEqual(before);
    expect(within(card).getByRole("button", { name: "Give" })).toBeInTheDocument();
    expect(pathname()).toBe("/today");
  });

  it("offers the early-give confirm dialog for a fromLastDose (interval) course too, not only fixedTimes (F8)", async () => {
    // F8: the eligibility test in `TodayPage.tsx`'s `give` callback is
    // deliberately kind-agnostic — this is the interval-schedule path
    // through the dialog every OTHER dialog test in this file leaves
    // uncovered (they all use Clover's `fixedTimes` Metacam course).
    const user = userEvent.setup();
    const { data, repo } = household();
    const course = courseOf(data, "Clover", "Metoclopramide"); // fromLastDose, intervalHours: 8
    const occurrence = makeOccurrence(course, { day: DAY, scheduledFor: LATER_TODAY });
    await register(repo, [occurrence]);
    setState(occurrence.key, "later");

    const marta = martaOf(data);
    // 30 min before FIXTURE_NOW — inside this 8h course's 90-minute
    // (capped, unscaled) `intervalGraceMinutes` window and past the
    // 10-minute `EARLY_GIVE_FLOOR_MIN` floor, so it collides via the
    // (bypassable) grace heuristic, not the floor.
    await seedConflictingEvent(repo, course, {
      actorId: marta.id,
      status: "given",
      givenAt: CONFLICTING_GIVEN_AT,
    });

    const before = await repo.listDoseEvents({});
    renderToday(repo);
    const card = await cardFor("Clover");

    await user.click(within(card).getByRole("button", { name: "Give" }));

    expect(await screen.findByText("Give Metoclopramide early?")).toBeInTheDocument();
    expect(
      screen.getByText("Marta gave the last dose 30 min ago. This one isn't due for another 45 min."),
    ).toBeInTheDocument();
    expect(await repo.listDoseEvents({})).toEqual(before);
  });

  it("confirming the early-give dialog logs the dose at the current time, past the grace-window collision", async () => {
    const user = userEvent.setup();
    const { data, repo } = household();
    const course = courseOf(data, "Clover", "Metacam");
    const occurrence = makeOccurrence(course, { day: DAY, scheduledFor: LATER_TODAY });
    await register(repo, [occurrence]);
    setState(occurrence.key, "later");

    const marta = martaOf(data);
    await seedConflictingEvent(repo, course, {
      actorId: marta.id,
      status: "given",
      givenAt: CONFLICTING_GIVEN_AT,
    });

    const before = await repo.listDoseEvents({});
    renderToday(repo);
    const card = await cardFor("Clover");

    await user.click(within(card).getByRole("button", { name: "Give" }));
    await screen.findByText("Give Metacam early?");

    await user.click(screen.getByRole("button", { name: "Give anyway" }));

    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent("Metacam logged");

    await waitFor(async () => {
      expect(await repo.listDoseEvents({})).toHaveLength(before.length + 1);
    });
    const created = newEvents(before, await repo.listDoseEvents({}));
    expect(created).toHaveLength(1);
    expect(created[0].status).toBe("given");
    // Logged at "now" (SPEC §5.1's Give rule), past the grace window the
    // first attempt collided with — the confirmed retry actually bypassed it.
    expect(created[0].givenAt).toBe(FIXTURE_NOW);
    expect(pathname()).toBe("/today");
  });

  // F2 regression: a collision on the SAME occurrence (not a different one)
  // must NEVER reach the early-give dialog, even though the dose is not yet
  // due — that hard block is unconditional and never bypassable, so a
  // dialog offering "Give anyway" over it could only ever loop or no-op.
  // `seedConflictingEvent`'s `givenAt` doubles as the conflicting event's
  // OWN `scheduledFor` (see the helper), so seeding it at the occurrence's
  // own `scheduledFor` deterministically reproduces what an async double-tap
  // does non-deterministically: tap 2 collides on the IDENTICAL occurrence,
  // not a nearby one.
  it("a duplicate collision on the SAME occurrence never opens the early-give dialog, even though the dose is not yet due", async () => {
    const user = userEvent.setup();
    const { data, repo } = household();
    const course = courseOf(data, "Clover", "Metacam");
    const occurrence = makeOccurrence(course, { day: DAY, scheduledFor: LATER_TODAY });
    await register(repo, [occurrence]);
    setState(occurrence.key, "later");

    const marta = martaOf(data);
    await seedConflictingEvent(repo, course, {
      actorId: marta.id,
      status: "given",
      givenAt: LATER_TODAY, // the occurrence's OWN scheduledFor — same occurrence, not a different one
    });

    const before = await repo.listDoseEvents({});
    renderToday(repo);
    const card = await cardFor("Clover");

    await user.click(within(card).getByRole("button", { name: "Give" }));

    // The flat rejection, worded exactly like SPEC §5's ordinary duplicate
    // toast (07:45 UTC = 08:45 BST) — never the early-give dialog's title.
    expect(await screen.findByText("Already given by Marta at 08:45")).toBeInTheDocument();
    expect(screen.queryByText(/early\?$/)).not.toBeInTheDocument();
    expect(await repo.listDoseEvents({})).toEqual(before);
  });

  // Live-UI regression: the dialog's Ukrainian body read "...(You)." — the
  // English word untranslated inside otherwise-Ukrainian prose — whenever the
  // colliding dose's actor was THIS device's own. Root cause: `displayNameFor`
  // returns a self-user's raw, stored `displayName` VERBATIM (SPEC §10a),
  // and an un-renamed self-user's stored name literally IS the English
  // "You" (`DEFAULT_SELF_DISPLAY_NAME`). Fixed the same way
  // `household.memberLine.you` already handles the self ROW in the member
  // list: `isSelf`, not the raw name, decides — the fixture's self user is
  // named "Roman" (`selfOf`, picked by `isSelf`, not by name), so this test
  // would still see "Roman" leak through untranslated if the fix ever
  // regressed to keying off the literal string "You" instead of `isSelf`.
  it("localises the actor token inside the Ukrainian early-give dialog when the colliding dose was logged by THIS device", async () => {
    const user = userEvent.setup();
    const { data, repo } = household();
    const course = courseOf(data, "Clover", "Metacam");
    const occurrence = makeOccurrence(course, { day: DAY, scheduledFor: LATER_TODAY });
    await register(repo, [occurrence]);
    setState(occurrence.key, "later");

    const self = selfOf(data);
    await seedConflictingEvent(repo, course, {
      actorId: self.id,
      status: "given",
      givenAt: CONFLICTING_GIVEN_AT,
    });

    renderWithProviders(
      <>
        <TodayPage />
        <LocationProbe />
      </>,
      { repo, route: "/today", locale: "uk" },
    );

    await user.click(await screen.findByRole("button", { name: "Дати" }));

    expect(await screen.findByText("Дати Metacam раніше?")).toBeInTheDocument();
    // "Ви" (SPEC-consistent with `household.memberLine.you`'s self-row
    // wording), never the raw stored "You" or the self user's real name
    // ("Roman") that `displayNameFor` would otherwise have surfaced.
    const description = await screen.findByText(
      "Попередню дозу дано 30 хв тому (Ви). Ця доза знадобиться ще через 45 хв.",
    );
    expect(description).toBeInTheDocument();
    expect(description).not.toHaveTextContent(/\bYou\b/);
    expect(description).not.toHaveTextContent("Roman");
  });

  it("keeps the portalled early-give confirm dialog inside a .ds-root token scope, so it is not painted with unresolved tokens", async () => {
    // `Dialog.Portal` moves the popup to the end of `<body>`, outside the
    // `DsRoot` the app mounts inside `#root`. Every DS token is declared on
    // `.ds-root` rather than `:root` (`components/ds/tokens/colors.css`), so
    // a popup that lands outside one paints `var(--surface)`/`var(--line-quiet)`
    // as nothing — the exact class of bug commit 866a4b1 fixed for
    // `LogAtTimeSheet.tsx` and every other portalled menu/dialog in this app.
    //
    // F5: `dialog.closest(".ds-root")` alone is vacuous — `className="ds-root"`
    // is on `Dialog.Popup` itself, and `Element.closest()` includes the start
    // element, so it would pass even if the popup were never portalled at
    // all (matching an ordinary ancestor instead) or even if it were
    // portalled with NO class of its own (matching nothing and returning
    // null either way is indistinguishable from "matched itself"). The
    // genuine claim has two parts, both asserted below: the popup really did
    // escape the app's own `DsRoot` subtree (`toContainElement` is false),
    // AND it independently re-establishes the token scope on itself
    // (`toHaveClass`, plus a real SECOND `.ds-root` node existing in the
    // document body, distinct from the app's own).
    const user = userEvent.setup();
    const { data, repo } = household();
    const course = courseOf(data, "Clover", "Metacam");
    const occurrence = makeOccurrence(course, { day: DAY, scheduledFor: LATER_TODAY });
    await register(repo, [occurrence]);
    setState(occurrence.key, "later");
    const marta = martaOf(data);
    await seedConflictingEvent(repo, course, {
      actorId: marta.id,
      status: "given",
      givenAt: CONFLICTING_GIVEN_AT,
    });

    const { container } = renderToday(repo);
    const card = await cardFor("Clover");
    await user.click(within(card).getByRole("button", { name: "Give" }));

    const dialog = await screen.findByRole("dialog", { name: "Give Metacam early?" });
    const appRoot = container.querySelector(".ds-root");
    expect(appRoot).not.toBeNull();
    // The dialog is NOT inside the app's own DsRoot subtree — proof the
    // portal genuinely moved it, not merely a structural assumption.
    expect(appRoot).not.toContainElement(dialog);
    // The dialog re-establishes the token scope on ITSELF.
    expect(dialog).toHaveClass("ds-root");
    // Two DISTINCT `.ds-root` nodes now exist in `document.body`: the app's
    // own, and the dialog's. If `className="ds-root"` were ever removed from
    // `Dialog.Popup`, this count drops to 1 and the test fails — the
    // assertion `.closest()` alone could never make.
    expect(document.querySelectorAll(".ds-root")).toHaveLength(2);
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

  it("logs at the occurrence's scheduled time through the sheet without leaving the dashboard", async () => {
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
    expect(pathname()).toBe("/today");
    await user.click(await screen.findByRole("menuitem", { name: "Log at a different time" }));

    // Every step of the sheet is a click inside a portal that is a React child
    // of the card wrapper, so each one is checked, not just the last.
    await screen.findByRole("dialog");
    expect(pathname()).toBe("/today");

    // The one-tap "At its scheduled time" row (SPEC §6.1a) — its value is the
    // occurrence's own `dueAt`, so the assertion below can pin `givenAt`
    // exactly rather than to an arbitrary chosen offset.
    await user.click(await screen.findByRole("button", { name: /At its scheduled time/ }));
    expect(pathname()).toBe("/today");

    await user.click(screen.getByRole("button", { name: "Log at 08:00" }));
    expect(pathname()).toBe("/today");

    await waitFor(async () => {
      expect(await repo.listDoseEvents({})).toHaveLength(before.length + 1);
    });

    const created = newEvents(before, await repo.listDoseEvents({}));
    expect(created).toHaveLength(1);
    expect(created[0].status).toBe("given");
    expect(created[0].givenAt).toBe(occurrence.dueAt?.toISOString());

    expect(pathname()).toBe("/today");
  });

  it("closes the sheet without logging when dismissed via its close control, without leaving the dashboard", async () => {
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
    expect(pathname()).toBe("/today");

    await user.click(screen.getByRole("button", { name: /more options/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Log at a different time" }));
    await screen.findByRole("dialog");
    expect(pathname()).toBe("/today");

    await user.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(await repo.listDoseEvents({})).toEqual(before);
    expect(pathname()).toBe("/today");
  });

  it("undoes a log made through the sheet, leaving listDoseEvents exactly as before", async () => {
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
    expect(pathname()).toBe("/today");

    await user.click(screen.getByRole("button", { name: /more options/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Log at a different time" }));
    await screen.findByRole("dialog");
    await user.click(await screen.findByRole("button", { name: /At its scheduled time/ }));
    await user.click(screen.getByRole("button", { name: "Log at 08:00" }));

    // The log really landed, so the undo below is undoing something.
    await waitFor(async () => {
      expect(await repo.listDoseEvents({})).toHaveLength(before.length + 1);
    });

    const toast = await screen.findByRole("status");
    await user.click(within(toast).getByRole("button", { name: "Undo" }));

    await waitFor(async () => {
      expect(await repo.listDoseEvents({})).toHaveLength(before.length);
    });
    expect(await repo.listDoseEvents({})).toEqual(before);
    expect(pathname()).toBe("/today");
  });

  // SPEC §5's dedup rule applies to §6.1a's sheet exactly as it does to Give:
  // "do not add a guard in the UI for this" — the sheet closes on confirm
  // (TodayDoseRow.tsx wraps `onConfirm` to close it before logging) and
  // `useLogDose.onError` is what surfaces the rejection.
  it("rejects a sheet confirmation landing on the SAME instant as another live event (F1's floor, below the grace window), leaving the ledger unchanged", async () => {
    const user = userEvent.setup();
    const { data, repo } = household();
    const course = courseOf(data, "Clover", "Metacam");
    const occurrence = makeOccurrence(course, { day: DAY, scheduledFor: AT_0800 });
    await register(repo, [occurrence]);
    setState(occurrence.key, "due");

    const marta = martaOf(data);
    await seedConflictingEvent(repo, course, {
      actorId: marta.id,
      status: "given",
      givenAt: CONFLICTING_GIVEN_AT,
    });

    const before = await repo.listDoseEvents({});
    renderToday(repo);
    await cardFor("Clover");
    expect(pathname()).toBe("/today");

    await user.click(screen.getByRole("button", { name: /more options/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Log at a different time" }));
    await screen.findByRole("dialog");

    // The sheet's default 30-minutes-ago offset (07:30 local) lands exactly on
    // `CONFLICTING_GIVEN_AT` (06:30 UTC = 07:30 local) — a ZERO-minute gap, so
    // this trips `EARLY_GIVE_FLOOR_MIN` (F1's hard floor, 10 min), not merely
    // the 60-minute fixedTimes grace window it is also well inside. The floor
    // is checked first and is never bypassable, so the flat rejection here is
    // the floor's message, not the generic duplicate one.
    await user.click(screen.getByRole("button", { name: "Log at 07:30" }));

    expect(
      await screen.findByText("A dose was logged for this course 0 min ago — wait a little before logging another"),
    ).toBeInTheDocument();

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

  // Deliberate Ukrainian coverage of SPEC's exactly-pinned empty-state string
  // (`today.emptyTitle`), rendered through the real screen rather than the
  // catalogue directly, so the wiring (not just the translation) is proven.
  it("shows the Ukrainian empty state when nothing is pending", async () => {
    const { repo } = household();
    await register(repo, []);
    engineStore.nextDue = new Date("2026-08-08T19:00:00.000Z"); // 20:00 BST

    renderWithProviders(
      <>
        <TodayPage />
        <LocationProbe />
      </>,
      { repo, route: "/today", locale: "uk" },
    );

    expect(await screen.findByText("Сьогодні нічого не заплановано.")).toBeInTheDocument();
    expect(screen.getByText("Наступна доза о 20:00")).toBeInTheDocument();
    expect(screen.queryByText("Nothing due today.")).not.toBeInTheDocument();
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

  // Audit finding d (ds/README.md "Deliberate differences from the source"):
  // the header's trailing IconButton had no `label`, so it fell back to the
  // glyph token "plus". Both the loading pass (no `view` yet) and the loaded
  // pass render their own `ScreenHeader`, so both need the real name.
  it("names the header's + control by what it does, not the glyph, before and after data loads", async () => {
    const user = userEvent.setup();
    const { repo } = household();

    renderToday(repo);

    const action = await screen.findByRole("button", { name: "Add a course" });
    expect(screen.queryByRole("button", { name: "plus" })).not.toBeInTheDocument();

    await screen.findByText(/Good (morning|afternoon|evening)/);
    expect(screen.getByRole("button", { name: "Add a course" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "plus" })).not.toBeInTheDocument();

    await user.click(action);
    await waitFor(() => {
      expect(pathname()).toBe("/courses/new");
    });
  });
});
