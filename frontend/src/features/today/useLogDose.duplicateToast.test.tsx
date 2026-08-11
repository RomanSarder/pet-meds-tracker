// SPEC §5: "Two people logging the same dose within the grace window produce
// one DoseEvent; the second log is rejected client-side with 'Already given
// by Marta at 07:12'." Split out from `useLogDose.test.tsx` so this rule has
// its own dedicated file: the duplicate-toast wording (who logged it, when,
// and whether it was a give or a skip) is its own concern from the
// optimistic-flip/undo behaviour that file already covers.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import type { Course, LocalDate } from "@/domain";
import { occurrenceKeyFor } from "@/domain";
import type { ToastOptions } from "@/app/Toast";
import type { Repo } from "@/data/repo.types";
import { createMemoryRepo } from "@/data/memoryRepo";
import { renderWithProviders, userEvent } from "@/test/renderWithProviders";
import { makeOccurrence, resetEngineStore, setOccurrences } from "./testEngine";
import { useLogDose, type LogDoseVars } from "./useLogDose";
import { useTodayQuery } from "./useTodayData";

/** 30 minutes before `FIXTURE_NOW` (07:00 UTC) — inside the 60-minute fixedTimes grace window. */
const CONFLICTING_GIVEN_AT = "2026-08-08T06:30:00.000Z";

// The engine is a typed stub on this branch (see testEngine.ts): unmocked, it
// would return `[]` for every day and no occurrence would ever exist to log.
vi.mock("@/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/engine")>();
  const { engineDouble } = await import("./testEngine");
  return { ...actual, ...engineDouble };
});

// NOT a replacement toast — `ToastProvider` and the context stay the real,
// frozen ones, so the toast still renders into the DOM. This only tees the
// options `useLogDose` passes to `show`.
const shown = vi.hoisted(() => ({ toasts: [] as Array<Record<string, unknown>> }));

vi.mock("@/app/Toast", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/Toast")>();
  return {
    ...actual,
    useToast: () => {
      const real = actual.useToast();
      return {
        show: (options: ToastOptions) => {
          shown.toasts.push(options as unknown as Record<string, unknown>);
          return real.show(options);
        },
      };
    },
  };
});

/** 2026-08-08 local (Europe/London) — the local day of FIXTURE_NOW. */
const DAY: LocalDate = "2026-08-08";
/** 08:00 BST today: the Clover/Metacam morning dose, which the fixtures leave unlogged. */
const SCHEDULED_FOR = "2026-08-08T07:00:00.000Z";

function Harness({ vars }: { vars: LogDoseVars }) {
  const query = useTodayQuery(DAY);
  const logDose = useLogDose(DAY);
  const occurrence = query.data?.occurrences.find((o) => o.key === vars.occurrenceKey);

  return (
    <div>
      <div data-testid="query-state">{query.isSuccess ? "ready" : "loading"}</div>
      <div data-testid="event-id">{occurrence?.event?.id ?? "none"}</div>
      <div data-testid="event-status">{occurrence?.event?.status ?? "none"}</div>
      <button type="button" onClick={() => logDose.mutate(vars)}>
        Give
      </button>
    </div>
  );
}

interface Fixture {
  repo: Repo;
  course: Course;
  vars: LogDoseVars;
}

/**
 * Builds the repo and registers the day's single occurrence with the engine
 * double, BEFORE anything renders. The course is picked by its shape rather
 * than by a hard-coded fixture id, so this test does not silently depend on
 * fixture ordering.
 */
async function seed(): Promise<Fixture> {
  const repo = createMemoryRepo();
  const courses = await repo.listCourses();
  const course = courses.find(
    (c) =>
      c.status === "active" &&
      c.schedule.kind === "fixedTimes" &&
      c.schedule.times.includes("08:00"),
  );
  if (!course) throw new Error("fixture drift: no active 08:00 fixedTimes course");

  setOccurrences(DAY, [makeOccurrence(course, { day: DAY, scheduledFor: SCHEDULED_FOR })]);

  return {
    repo,
    course,
    vars: {
      occurrenceKey: occurrenceKeyFor(course.id, SCHEDULED_FOR),
      courseId: course.id,
      scheduledFor: SCHEDULED_FOR,
      amount: course.doseAmount,
      status: "given",
      medicationName: "Metacam",
      toastMessage: "Metacam logged",
    },
  };
}

async function waitReady(): Promise<void> {
  await screen.findByText("ready");
}

async function clickGive(): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Give" }));
}

/** The fixtures' second household member — picked by name, not by a hard-coded id. */
async function findMarta(repo: Repo): Promise<{ id: string }> {
  const marta = (await repo.listUsers()).find((u) => u.displayName === "Marta");
  if (!marta) throw new Error("fixture drift: no Marta member");
  return marta;
}

/**
 * Inserts a live `DoseEvent` for `course` with the given actor, status and
 * `givenAt`, bypassing `logDose` — which always stamps the CURRENT device's
 * `currentActorId()` and could never produce an event attributed to Marta.
 * `applyRemoteChanges` is the repo's own ledger-insert path (what W9 sync
 * uses), so this is a real row the dedup guard in `logDose` will see, not a
 * hand-rolled test-only shortcut.
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

beforeEach(() => {
  resetEngineStore();
  shown.toasts.length = 0;
});

describe("useLogDose — duplicate-toast wording (SPEC §5)", () => {
  // This is the "given" half; the sibling test below covers the "skipped"
  // wording, since SPEC requires the copy to say accurately which one
  // happened.
  it("names who and when a duplicate Give is rejected, without persisting a second event", async () => {
    const { repo, course, vars } = await seed();
    const marta = await findMarta(repo);
    await seedConflictingEvent(repo, course, {
      actorId: marta.id,
      status: "given",
      givenAt: CONFLICTING_GIVEN_AT,
    });

    const before = await repo.listDoseEvents({ courseId: course.id });
    renderWithProviders(<Harness vars={vars} />, { repo });

    await waitReady();
    await clickGive();

    // 06:30 UTC = 07:30 local (Europe/London, BST) — SPEC §5's exact copy
    // shape, "Already given by Marta at 07:12", with this fixture's own name
    // and time.
    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent("Already given by Marta at 07:30");
    // No Undo action on a rejection — there is nothing this device logged to undo.
    expect(within(toast).queryByRole("button", { name: "Undo" })).toBeNull();

    // The optimistic flip is rolled back: the row reads "none" again, and no
    // second event was ever written.
    await waitFor(() => {
      expect(screen.getByTestId("event-id")).toHaveTextContent("none");
    });
    expect(await repo.listDoseEvents({ courseId: course.id })).toEqual(before);
  });

  // SPEC §5/§12: removal ends a membership, it never rewrites history — a
  // removed member's name must keep rendering on the events they logged.
  // History and Pet detail always resolved this correctly (they read the
  // `includeRemoved: true` roster); this hook read the live-only one, so the
  // SAME actor on the SAME device was named in History and "Someone" here.
  it("still names a REMOVED member on their conflicting event, not 'Someone'", async () => {
    const { repo, course, vars } = await seed();
    const marta = await findMarta(repo);
    await seedConflictingEvent(repo, course, {
      actorId: marta.id,
      status: "given",
      givenAt: CONFLICTING_GIVEN_AT,
    });
    await repo.removeUser(marta.id);
    // Guard against the fixture drifting into a state where this proves
    // nothing: Marta must genuinely be gone from the live roster.
    expect((await repo.listUsers()).some((u) => u.id === marta.id)).toBe(false);

    renderWithProviders(<Harness vars={vars} />, { repo });
    await waitReady();
    await clickGive();

    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent("Already given by Marta at 07:30");
    expect(toast).not.toHaveTextContent("Someone");
  });

  it("says 'skipped', not 'given', when the conflicting event was a skip", async () => {
    const { repo, course, vars } = await seed();
    const marta = await findMarta(repo);
    await seedConflictingEvent(repo, course, {
      actorId: marta.id,
      status: "skipped",
      givenAt: CONFLICTING_GIVEN_AT,
    });

    renderWithProviders(<Harness vars={vars} />, { repo });
    await waitReady();
    await clickGive();

    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent("Already skipped by Marta at 07:30");
    expect(toast).not.toHaveTextContent("Already given");
  });
});
