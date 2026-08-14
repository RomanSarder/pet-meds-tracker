// The once-per-local-day sweep: SPEC §4's missed-dose backfill and SPEC §3c's
// auto-transition to `finished`, plus the `lastSweepDay` guard that keeps both
// from running twice in one day.
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import type { Course, LocalDate } from "@/domain";
import { FIXTURE_NOW, occurrenceKeyFor } from "@/domain";
import type { Repo } from "@/data/repo.types";
import { createMemoryRepo } from "@/data/memoryRepo";
import { clearSessionEstablished, markSessionEstablished } from "@/shared/session";
import { markSyncedSinceLoad, resetSyncedSinceLoad } from "@/sync/freshness";
import { renderWithProviders, userEvent } from "@/test/renderWithProviders";
import { engineStore, makeOccurrence, resetEngineStore } from "./testEngine";
import { useDailySweep } from "./useDailySweep";

// On this branch `findMissedOccurrences` and `findCoursesToFinish` are typed
// stubs returning `[]`, so without this double the sweep would have nothing to
// carry to the repo and every assertion below would be vacuous.
vi.mock("@/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/engine")>();
  const { engineDouble } = await import("./testEngine");
  return { ...actual, ...engineDouble };
});

const DAY: LocalDate = "2026-08-08";
const NOW = new Date(FIXTURE_NOW);
/** 08:00 BST today — the Clover/Metacam morning dose the fixtures leave unlogged. */
const SCHEDULED_FOR = "2026-08-08T07:00:00.000Z";

function SweepHarness() {
  useDailySweep(NOW);
  return <div data-testid="sweep-harness">mounted</div>;
}

/**
 * The same harness with a `now` the test can advance, standing in for the 30s
 * `useNow` tick that re-runs the effect in the app. Needed to show that a
 * DEFERRED sweep is retried rather than lost.
 */
function TickingSweepHarness() {
  const [now, setNow] = useState(NOW);
  useDailySweep(now);
  return (
    <button data-testid="tick" onClick={() => setNow(new Date(NOW.getTime() + 30_000))}>
      tick
    </button>
  );
}

async function seed(): Promise<{ repo: Repo; fixedTimesCourse: Course; intervalCourse: Course }> {
  const repo = createMemoryRepo();
  const courses = await repo.listCourses();
  const fixedTimesCourse = courses.find(
    (c) =>
      c.status === "active" &&
      c.schedule.kind === "fixedTimes" &&
      c.schedule.times.includes("08:00"),
  );
  const intervalCourse = courses.find(
    (c) => c.status === "active" && c.schedule.kind === "fromLastDose",
  );
  if (!fixedTimesCourse || !intervalCourse) {
    throw new Error("fixture drift: expected an active fixedTimes and fromLastDose course");
  }
  return { repo, fixedTimesCourse, intervalCourse };
}

beforeEach(() => {
  resetEngineStore();
  // No session and no completed cycle: the local store is the whole household,
  // which is the state every pre-existing case here was written against.
  clearSessionEstablished();
  resetSyncedSinceLoad();
});

describe("useDailySweep", () => {
  it("writes the engine's missed occurrences to history and stamps lastSweepDay", async () => {
    const { repo, fixedTimesCourse, intervalCourse } = await seed();

    engineStore.missed = [
      makeOccurrence(fixedTimesCourse, { day: DAY, scheduledFor: SCHEDULED_FOR }),
      // COMMON §6 item 15: an interval chain with no anchor has no scheduled
      // instant, so it can be late but never missed. It must be skipped rather
      // than written with an invented `scheduledFor`.
      makeOccurrence(intervalCourse, { day: DAY, scheduledFor: null }),
    ];

    const before = await repo.listDoseEvents({});
    expect(await repo.getMeta("lastSweepDay")).toBeNull();

    renderWithProviders(<SweepHarness />, { repo });

    await waitFor(async () => {
      expect(await repo.getMeta("lastSweepDay")).toBe(DAY);
    });

    const after = await repo.listDoseEvents({});
    const created = after.filter((e) => !before.some((b) => b.id === e.id));
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      courseId: fixedTimesCourse.id,
      status: "missed",
      scheduledFor: SCHEDULED_FOR,
      amount: fixedTimesCourse.doseAmount,
      occurrenceKey: occurrenceKeyFor(fixedTimesCourse.id, SCHEDULED_FOR),
      deletedAt: null,
    });
    expect(created.some((e) => e.courseId === intervalCourse.id)).toBe(false);
  });

  it("does not sweep twice in the same local day", async () => {
    const { repo, fixedTimesCourse } = await seed();
    engineStore.missed = [
      makeOccurrence(fixedTimesCourse, { day: DAY, scheduledFor: SCHEDULED_FOR }),
    ];

    // Spying on the repo (passed in via `renderWithProviders`) rather than
    // counting rows is what makes this a test of the `lastSweepDay` guard.
    // `recordMissed` is idempotent on `occurrenceKey` all by itself, so a row
    // count would stay flat even if the guard were missing entirely.
    const recordMissed = vi.spyOn(repo, "recordMissed");
    const getMeta = vi.spyOn(repo, "getMeta");

    const first = renderWithProviders(<SweepHarness />, { repo });
    await waitFor(async () => {
      expect(await repo.getMeta("lastSweepDay")).toBe(DAY);
    });
    expect(recordMissed).toHaveBeenCalledTimes(1);

    const eventsAfterFirst = await repo.listDoseEvents({});
    const readsAfterFirst = getMeta.mock.calls.filter(([key]) => key === "lastSweepDay").length;
    first.unmount();

    renderWithProviders(<SweepHarness />, { repo });
    await screen.findByTestId("sweep-harness");

    // Wait until the second sweep has actually consulted `lastSweepDay` —
    // otherwise "recordMissed was not called again" would pass simply because
    // the effect had not got that far yet.
    await waitFor(() => {
      const reads = getMeta.mock.calls.filter(([key]) => key === "lastSweepDay").length;
      expect(reads).toBeGreaterThan(readsAfterFirst);
    });

    expect(recordMissed).toHaveBeenCalledTimes(1);
    expect(await repo.listDoseEvents({})).toEqual(eventsAfterFirst);
  });

  // A signed-in device renders from IndexedDB before its first `/sync/pull`
  // lands. Sweeping there marks another member's already-given dose as missed
  // — permanently, since the ledger is append-only.
  describe("before the first sync cycle of this page load", () => {
    it("writes nothing and leaves the day unswept while a session exists but no cycle has completed", async () => {
      const { repo, fixedTimesCourse } = await seed();
      markSessionEstablished();
      engineStore.missed = [
        makeOccurrence(fixedTimesCourse, { day: DAY, scheduledFor: SCHEDULED_FOR }),
      ];
      const recordMissed = vi.spyOn(repo, "recordMissed");
      const before = await repo.listDoseEvents({});

      renderWithProviders(<SweepHarness />, { repo });
      await screen.findByTestId("sweep-harness");

      // Nothing to wait FOR — assert the absence settles rather than racing it.
      await waitFor(() => {
        expect(screen.getByTestId("sweep-harness")).toBeInTheDocument();
      });
      expect(recordMissed).not.toHaveBeenCalled();
      expect(await repo.listDoseEvents({})).toEqual(before);
      expect(await repo.getMeta("lastSweepDay")).toBeNull();
    });

    it("sweeps once a cycle completes — the deferral holds the day open rather than consuming it", async () => {
      const { repo, fixedTimesCourse } = await seed();
      markSessionEstablished();
      engineStore.missed = [
        makeOccurrence(fixedTimesCourse, { day: DAY, scheduledFor: SCHEDULED_FOR }),
      ];

      const before = await repo.listDoseEvents({});
      renderWithProviders(<TickingSweepHarness />, { repo });
      await screen.findByTestId("tick");
      expect(await repo.getMeta("lastSweepDay")).toBeNull();

      markSyncedSinceLoad();
      await userEvent.click(screen.getByTestId("tick"));

      await waitFor(async () => {
        expect(await repo.getMeta("lastSweepDay")).toBe(DAY);
      });
      const created = (await repo.listDoseEvents({})).filter(
        (e) => !before.some((b) => b.id === e.id),
      );
      expect(created).toHaveLength(1);
      expect(created[0].occurrenceKey).toBe(occurrenceKeyFor(fixedTimesCourse.id, SCHEDULED_FOR));
    });

    it("sweeps immediately on a device with no session — there is no pull to wait for", async () => {
      const { repo, fixedTimesCourse } = await seed();
      engineStore.missed = [
        makeOccurrence(fixedTimesCourse, { day: DAY, scheduledFor: SCHEDULED_FOR }),
      ];

      renderWithProviders(<SweepHarness />, { repo });

      await waitFor(async () => {
        expect(await repo.getMeta("lastSweepDay")).toBe(DAY);
      });
    });
  });

  it("finishes the courses the engine nominates", async () => {
    const { repo, fixedTimesCourse } = await seed();
    engineStore.coursesToFinish = [fixedTimesCourse.id];
    expect(fixedTimesCourse.status).toBe("active");

    renderWithProviders(<SweepHarness />, { repo });

    await waitFor(async () => {
      expect((await repo.getCourse(fixedTimesCourse.id))?.status).toBe("finished");
    });
  });
});
