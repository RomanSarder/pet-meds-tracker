// Slice 5's load-bearing behavioural test: one-tap logging, its optimistic
// flip, its undo toast, and SPEC §11's "logging then undoing a dose leaves
// history exactly as before, and never touches stock" — asserted as data
// (a deep equality over the repo's own rows), not by reading the screen.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import type { Course, DoseEvent, LocalDate } from "@/domain";
import { UNDO_WINDOW_MS, occurrenceKeyFor, qk } from "@/domain";
import type { ToastOptions } from "@/app/Toast";
import type { Repo } from "@/data/repo.types";
import { createMemoryRepo } from "@/data/memoryRepo";
import { renderWithProviders, userEvent } from "@/test/renderWithProviders";
import { makeOccurrence, resetEngineStore, setOccurrences } from "./testEngine";
import type { TodaySnapshot } from "./types";
import { useLogDose, type LogDoseVars } from "./useLogDose";
import { useTodayQuery } from "./useTodayData";

// The engine is a typed stub on this branch (see testEngine.ts): unmocked, it
// would return `[]` for every day and no occurrence would ever exist to log.
vi.mock("@/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/engine")>();
  const { engineDouble } = await import("./testEngine");
  return { ...actual, ...engineDouble };
});

// NOT a replacement toast — `ToastProvider` and the context stay the real,
// frozen ones, so the toast still renders into the DOM and is still driven by
// its real timer. This only tees the options `useLogDose` passes to `show`, so
// `durationMs` can be asserted exactly rather than inferred from how long a
// DOM node happens to survive.
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

beforeEach(() => {
  resetEngineStore();
  shown.toasts.length = 0;
});

describe("useLogDose", () => {
  it("flips the cached occurrence to a provisional event before the write resolves", async () => {
    const { repo, vars } = await seed();

    // Hold the write open so "before the mutation resolves" is an instant the
    // test controls, not a race it hopes to win.
    let releaseWrite!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const realLogDose = repo.logDose;
    const logDoseSpy = vi.fn(async (input: Parameters<Repo["logDose"]>[0]) => {
      await writeGate;
      return realLogDose(input);
    });
    repo.logDose = logDoseSpy;

    const before = await repo.listDoseEvents({});
    const { queryClient } = renderWithProviders(<Harness vars={vars} />, { repo });

    await waitReady();
    await clickGive();

    // The row carries an event already — no spinner, no navigation, nothing
    // persisted yet.
    await waitFor(() => {
      expect(screen.getByTestId("event-id")).toHaveTextContent("optimistic");
    });
    expect(screen.getByTestId("event-status")).toHaveTextContent("given");
    expect(await repo.listDoseEvents({})).toEqual(before);

    // The cache entry itself, not merely what this harness chose to render.
    const optimistic = queryClient.getQueryData<TodaySnapshot>(qk.today(DAY));
    const flipped = optimistic?.occurrences.find((o) => o.key === vars.occurrenceKey);
    expect(flipped?.event?.id).toBe("optimistic");
    expect(flipped?.event?.status).toBe("given");
    // Every other occurrence is untouched.
    expect(optimistic?.occurrences.filter((o) => o.event !== null)).toHaveLength(1);

    releaseWrite();

    await waitFor(async () => {
      expect(await repo.listDoseEvents({})).toHaveLength(before.length + 1);
    });

    const after = await repo.listDoseEvents({});
    const created = after.filter((e) => !before.some((b) => b.id === e.id));
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      courseId: vars.courseId,
      status: "given",
      scheduledFor: SCHEDULED_FOR,
      amount: vars.amount,
      occurrenceKey: vars.occurrenceKey,
      supersedesId: null,
      deletedAt: null,
    });
    expect(logDoseSpy).toHaveBeenCalledTimes(1);
  });

  it("shows the success toast with an Undo action lasting exactly the undo window", async () => {
    const { repo, vars } = await seed();
    renderWithProviders(<Harness vars={vars} />, { repo });

    await waitReady();
    await clickGive();

    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent("Metacam logged");
    expect(within(toast).getByRole("button", { name: "Undo" })).toBeInTheDocument();

    expect(shown.toasts).toHaveLength(1);
    expect(shown.toasts[0]).toMatchObject({
      message: "Metacam logged",
      actionLabel: "Undo",
      durationMs: UNDO_WINDOW_MS,
    });
  });

  it("leaves dose history and stock exactly as they were after log-then-undo", async () => {
    const { repo, vars } = await seed();

    const eventsBefore = await repo.listDoseEvents({});
    const medicationsBefore = await repo.listMedications();
    const stockBefore = await repo.listStockAdjustments();
    // `listDoseEvents` filters `deletedAt === null` (memoryRepo.ts:285), so it
    // cannot see a tombstone. `exportHousehold` copies the dose-event array raw
    // (memoryRepo.ts:454-464), so it can.
    const backupBefore = (await repo.exportHousehold()).doseEvents;

    renderWithProviders(<Harness vars={vars} />, { repo });
    await waitReady();
    await clickGive();

    // The log really landed first, so the undo below is undoing something.
    await waitFor(async () => {
      expect(await repo.listDoseEvents({})).toHaveLength(eventsBefore.length + 1);
    });

    const toast = await screen.findByRole("status");
    const user = userEvent.setup();
    await user.click(within(toast).getByRole("button", { name: "Undo" }));

    await waitFor(async () => {
      expect(await repo.listDoseEvents({})).toHaveLength(eventsBefore.length);
    });

    // SPEC §11: "leaves history exactly as before" — a full deep equality over
    // every surviving row, not just a count.
    const eventsAfter = await repo.listDoseEvents({});
    expect(eventsAfter).toEqual(eventsBefore);

    // The two assertions fail for different reasons, so both are needed. The
    // one above would still pass against a soft delete: the tombstoned row is
    // filtered out of this view and looks gone. Only the unfiltered export can
    // tell "the row was removed" from "the row is still there, hidden" — which
    // is what makes `retractDoseEvent` a bounded HARD delete, and not a soft
    // delete or a compensating row, an actually tested claim.
    expect((await repo.exportHousehold()).doseEvents).toEqual(backupBefore);

    // SPEC §11: "logging any number of doses leaves `stockUnits` unchanged".
    const medicationsAfter = await repo.listMedications();
    expect(medicationsAfter.map((m) => m.stockUnits)).toEqual(
      medicationsBefore.map((m) => m.stockUnits),
    );
    expect(medicationsAfter).toEqual(medicationsBefore);
    // The stock ledger is where a hidden draw-down would show up even if the
    // cached `stockUnits` happened to net out.
    expect(await repo.listStockAdjustments()).toEqual(stockBefore);
  });

  // SPEC §5's duplicate-toast wording (who logged it, when, given-vs-skipped)
  // has its own dedicated file: `useLogDose.duplicateToast.test.tsx`.

  it("restores the pre-log snapshot and shows a generic toast when the write fails", async () => {
    const { repo, vars } = await seed();

    let releaseWrite!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    // An ordinary Error, not `DuplicateDoseError`/`RetractWindowExpiredError`
    // — the unnamed-error path both those named ones fall through to.
    repo.logDose = async () => {
      await writeGate;
      throw new Error("write failed");
    };

    // Block every refetch after the initial load. Without this, `onSettled`'s
    // invalidation would restore the row on its own and the test would pass
    // even with `onError` deleted — it must be `onError` that puts the
    // snapshot back, and nothing else.
    let releaseReads!: () => void;
    const readGate = new Promise<void>((resolve) => {
      releaseReads = resolve;
    });
    const realListDoseEvents = repo.listDoseEvents;
    let listCalls = 0;
    repo.listDoseEvents = async (filter): Promise<DoseEvent[]> => {
      listCalls += 1;
      if (listCalls > 1) await readGate;
      return realListDoseEvents(filter);
    };

    const eventsBefore = await realListDoseEvents({});
    const { queryClient } = renderWithProviders(<Harness vars={vars} />, { repo });

    await waitReady();
    const previous = queryClient.getQueryData<TodaySnapshot>(qk.today(DAY));
    await clickGive();

    await waitFor(() => {
      expect(screen.getByTestId("event-id")).toHaveTextContent("optimistic");
    });

    releaseWrite();

    await waitFor(() => {
      expect(screen.getByTestId("event-id")).toHaveTextContent("none");
    });

    const restored = queryClient.getQueryData<TodaySnapshot>(qk.today(DAY));
    expect(restored?.occurrences).toEqual(previous?.occurrences);
    expect(restored?.occurrences.every((o) => o.event === null)).toBe(true);
    expect(await realListDoseEvents({})).toEqual(eventsBefore);

    // ANY mutation failure now surfaces a message rather than nothing — a
    // plain factual toast, with no Undo action to offer.
    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent("Could not log the dose");
    expect(within(toast).queryByRole("button", { name: "Undo" })).toBeNull();
    expect(shown.toasts).toHaveLength(1);

    // Let the blocked refetch drain so nothing is left in flight at teardown.
    releaseReads();
    await waitFor(() => {
      expect(screen.getByTestId("query-state")).toHaveTextContent("ready");
    });
  });
});
