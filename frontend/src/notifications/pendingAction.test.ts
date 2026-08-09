// Cold start: a notification click with no page open arrives here as a URL.
// The one invariant that matters is "a refresh cannot double-log" — proven
// below by driving the same mutable `win` double through two drains.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Course } from "@/domain";
import { fixedClock, occurrenceKeyFor } from "@/domain";
import { setRepo, type Repo } from "@/data";
import { createMemoryRepo } from "@/data/memoryRepo";
import { drainPendingAction } from "./pendingAction";
import { AlertLedger, type LedgerStorage } from "./ledger";
import { buildActionUrl } from "./protocol";
import type { ActionDeps } from "./actions";
import type { DoseRef } from "./types";

const NOW = "2026-08-08T08:00:00.000Z";
const SCHEDULED_FOR = "2026-08-08T07:00:00.000Z";

function memoryLedgerStorage(): LedgerStorage {
  let value: string | null = null;
  return { read: () => value, write: (v: string) => (value = v) };
}

function makeDeps(): ActionDeps {
  return { ledger: new AlertLedger(memoryLedgerStorage()), clock: fixedClock(NOW) };
}

/** A minimal `Window` double whose `history.replaceState` actually mutates `location`. */
function makeWin(initialSearch: string): Window {
  const location = { search: initialSearch, pathname: "/", hash: "" };
  return {
    location,
    history: {
      replaceState: (_state: unknown, _title: string, url: string) => {
        const parsed = new URL(url, "https://example.com");
        location.pathname = parsed.pathname;
        location.search = parsed.search;
        location.hash = parsed.hash;
      },
    },
  } as unknown as Window;
}

async function findGivableCourse(repo: Repo): Promise<Course> {
  const courses = await repo.listCourses();
  const course = courses.find(
    (c) => c.status === "active" && c.schedule.kind === "fixedTimes" && c.schedule.times.includes("08:00"),
  );
  if (!course) throw new Error("fixture drift: no active 08:00 fixedTimes course");
  return course;
}

function giveSearchFor(dose: DoseRef): string {
  return new URL(buildActionUrl("https://example.com", "give", dose)).search;
}

describe("drainPendingAction", () => {
  let repo: Repo;

  beforeEach(() => {
    repo = createMemoryRepo();
    setRepo(repo);
  });

  it("drains a give action, logs exactly one dose, and strips the params", async () => {
    const course = await findGivableCourse(repo);
    const dose: DoseRef = {
      occurrenceKey: occurrenceKeyFor(course.id, SCHEDULED_FOR),
      courseId: course.id,
      scheduledFor: SCHEDULED_FOR,
      amount: course.doseAmount,
    };
    const win = makeWin(giveSearchFor(dose));
    const before = await repo.listDoseEvents({ courseId: course.id });

    await drainPendingAction(makeDeps(), win);

    const after = await repo.listDoseEvents({ courseId: course.id });
    expect(after).toHaveLength(before.length + 1);
    expect(win.location.search).toBe("");
  });

  it("does not double-log when drained twice", async () => {
    const course = await findGivableCourse(repo);
    const dose: DoseRef = {
      occurrenceKey: occurrenceKeyFor(course.id, SCHEDULED_FOR),
      courseId: course.id,
      scheduledFor: SCHEDULED_FOR,
      amount: course.doseAmount,
    };
    const win = makeWin(giveSearchFor(dose));
    const before = await repo.listDoseEvents({ courseId: course.id });

    await drainPendingAction(makeDeps(), win);
    await drainPendingAction(makeDeps(), win);

    const after = await repo.listDoseEvents({ courseId: course.id });
    expect(after).toHaveLength(before.length + 1);
  });

  it("does nothing when the URL carries no action", async () => {
    const win = makeWin("?utm_source=newsletter");
    const before = await repo.listDoseEvents({});

    await drainPendingAction(makeDeps(), win);

    expect(await repo.listDoseEvents({})).toEqual(before);
    expect(win.location.search).toBe("?utm_source=newsletter");
  });

  it("still logs a Give that arrived by URL when Notification is undefined", async () => {
    const originalNotification = (globalThis as { Notification?: unknown }).Notification;
    (globalThis as { Notification?: unknown }).Notification = undefined;
    try {
      const course = await findGivableCourse(repo);
      const dose: DoseRef = {
        occurrenceKey: occurrenceKeyFor(course.id, SCHEDULED_FOR),
        courseId: course.id,
        scheduledFor: SCHEDULED_FOR,
        amount: course.doseAmount,
      };
      const win = makeWin(giveSearchFor(dose));
      const before = await repo.listDoseEvents({ courseId: course.id });

      await drainPendingAction(makeDeps(), win);

      expect(await repo.listDoseEvents({ courseId: course.id })).toHaveLength(before.length + 1);
    } finally {
      (globalThis as { Notification?: unknown }).Notification = originalNotification;
    }
  });

  it("does not throw and still performs the action when history.replaceState is unavailable", async () => {
    const consoleSpies = [
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "log").mockImplementation(() => {}),
    ];
    try {
      const course = await findGivableCourse(repo);
      const dose: DoseRef = {
        occurrenceKey: occurrenceKeyFor(course.id, SCHEDULED_FOR),
        courseId: course.id,
        scheduledFor: SCHEDULED_FOR,
        amount: course.doseAmount,
      };
      const win = {
        location: { search: giveSearchFor(dose), pathname: "/", hash: "" },
        history: {},
      } as unknown as Window;
      const before = await repo.listDoseEvents({ courseId: course.id });

      await expect(drainPendingAction(makeDeps(), win)).resolves.toBeUndefined();

      expect(await repo.listDoseEvents({ courseId: course.id })).toHaveLength(before.length + 1);
      for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });
});
