// The acceptance tests for the whole notifications slice (W10-CONTRACT.md
// "Tests that must exist and pass"). Time is driven exclusively by moving a
// hand-rolled movable `Clock` and calling `tick()` directly — never real
// timers — per the contract's explicit instruction.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Clock, Course } from "@/domain";
import { FIXTURE_NOW, GRACE_FIXED_MIN, MISSED_AFTER_HOURS, occurrenceKeyFor } from "@/domain";
import { setRepo, type Repo } from "@/data";
import { createMemoryRepo } from "@/data/memoryRepo";
import type { DoseState } from "@/engine";
import { setCurrentLocale } from "@/i18n/current";
import { performGive, performSnooze, type ActionDeps } from "./actions";
import { AlertLedger, type LedgerStorage } from "./ledger";
import { createNotificationScheduler, decideAlert, POLL_INTERVAL_MS } from "./scheduler";
import type { AlertRecord, NotificationSpec } from "./types";

// The scheduler builds its notification titles via `notifications/copy.ts`'s
// `buildTitle`, which now reads `currentTranslator()` (I18N-DESIGN.md §2.5)
// instead of a hard-coded English translator. Nothing in this file renders
// through `renderWithProviders` to pin a locale, so pin it file-wide here —
// applies to every nested `describe`/`it` below.
beforeEach(() => {
  setCurrentLocale("en");
});

// --- shared test helpers ---------------------------------------------------

function memoryStorage(): LedgerStorage {
  let value: string | null = null;
  return {
    read: () => value,
    write: (v: string) => {
      value = v;
    },
  };
}

/** A `Clock` whose `now()` can be moved forward (or anywhere) by the test. */
function movableClock(initialIso: string): Clock & { set(iso: string): void } {
  let current = initialIso;
  return {
    now: () => new Date(current),
    set(iso: string): void {
      current = iso;
    },
  };
}

function plusMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

/** `tick()` never touches the timers — a spy pair is enough to satisfy the type. */
function fakeTimers(): { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout } {
  return {
    setTimeout: vi.fn() as unknown as typeof setTimeout,
    clearTimeout: vi.fn() as unknown as typeof clearTimeout,
  };
}

/** A spy-able `show` with the exact `(spec: NotificationSpec) => Promise<boolean>` shape,
 *  typed explicitly so `vi.fn()`'s generic inference does not collapse to `Procedure`. */
function fakeShow() {
  return vi.fn((_spec: NotificationSpec) => Promise.resolve(true));
}
type ShowSpy = ReturnType<typeof fakeShow>;

/** The Clover/Metacam fixedTimes 08:00/20:00 course — its today occurrence is
 *  due exactly at FIXTURE_NOW and unlogged (SPEC §7's own fixture). */
async function findCloverMetacamCourse(repo: Repo): Promise<Course> {
  const courses = await repo.listCourses();
  const course = courses.find(
    (c) =>
      c.status === "active" &&
      c.schedule.kind === "fixedTimes" &&
      c.schedule.times.includes("08:00") &&
      c.schedule.times.includes("20:00"),
  );
  if (!course) throw new Error("fixture drift: no active Clover/Metacam course");
  return course;
}

function callsFor(show: ShowSpy, courseId: string): NotificationSpec[] {
  return show.mock.calls.map(([spec]) => spec).filter((s) => s.dose.courseId === courseId);
}

// --- decideAlert: pure, exhaustive ------------------------------------------

describe("decideAlert", () => {
  const DUE = new Date("2026-08-08T07:00:00.000Z").getTime();

  it("is null before the due time, even though state is already 'due' inside the 30-min early window", () => {
    // Proves the refusal: SPEC §4's `due` state opens 30 min early for the
    // UI, but §7 fires the notification AT the scheduled time, not before.
    expect(decideAlert({ state: "due", dueAtMs: DUE, nowMs: DUE - 10 * 60_000, record: null })).toBeNull();
  });

  it("is 'due' exactly at the due time", () => {
    expect(decideAlert({ state: "due", dueAtMs: DUE, nowMs: DUE, record: null })).toBe("due");
  });

  it("is 'due' after the due time while state is still 'due'", () => {
    expect(decideAlert({ state: "due", dueAtMs: DUE, nowMs: DUE + 5 * 60_000, record: null })).toBe("due");
  });

  it("is 'overdue' once state is overdue", () => {
    expect(decideAlert({ state: "overdue", dueAtMs: DUE, nowMs: DUE + 90 * 60_000, record: null })).toBe(
      "overdue",
    );
  });

  it.each(["given", "skipped", "later", "upcoming", "notStarted"] as DoseState[])(
    "is null for state '%s' regardless of timing",
    (state) => {
      expect(decideAlert({ state, dueAtMs: DUE, nowMs: DUE, record: null })).toBeNull();
    },
  );

  it("suppresses entirely while snoozed, even if the state would otherwise alert", () => {
    const record: AlertRecord = { key: "k", reasons: ["due"], snoozeUntil: DUE + 30 * 60_000, updatedAt: DUE };
    expect(decideAlert({ state: "overdue", dueAtMs: DUE, nowMs: DUE + 20 * 60_000, record })).toBeNull();
  });

  it("fires 'snooze' once the snooze window has elapsed and 'snooze' has not fired yet", () => {
    const record: AlertRecord = { key: "k", reasons: ["due"], snoozeUntil: DUE + 30 * 60_000, updatedAt: DUE };
    expect(decideAlert({ state: "overdue", dueAtMs: DUE, nowMs: DUE + 30 * 60_000, record })).toBe("snooze");
  });

  it("does not re-fire 'snooze', falling through to the state rule instead", () => {
    const record: AlertRecord = {
      key: "k",
      reasons: ["due", "snooze"],
      snoozeUntil: DUE + 30 * 60_000,
      updatedAt: DUE,
    };
    expect(decideAlert({ state: "overdue", dueAtMs: DUE, nowMs: DUE + 40 * 60_000, record })).toBe("overdue");
  });

  it("respects the staleness bound: null once more than MISSED_AFTER_HOURS past due", () => {
    const nowMs = DUE + (MISSED_AFTER_HOURS * 60 + 1) * 60_000;
    expect(decideAlert({ state: "overdue", dueAtMs: DUE, nowMs, record: null })).toBeNull();
  });

  it("is still non-null just under the staleness bound (proves the bound, not something else, is the gate)", () => {
    const nowMs = DUE + (MISSED_AFTER_HOURS * 60 - 1) * 60_000;
    expect(decideAlert({ state: "overdue", dueAtMs: DUE, nowMs, record: null })).toBe("overdue");
  });
});

// --- scheduler: fixedTimes exactly one notification -------------------------

describe("createNotificationScheduler — fixedTimes fires exactly once", () => {
  let repo: Repo;
  let courseId: string;
  let clock: ReturnType<typeof movableClock>;
  let show: ShowSpy;
  let scheduler: ReturnType<typeof createNotificationScheduler>;

  beforeEach(async () => {
    repo = createMemoryRepo();
    setRepo(repo);
    courseId = (await findCloverMetacamCourse(repo)).id;
    clock = movableClock(FIXTURE_NOW);
    show = fakeShow();
    scheduler = createNotificationScheduler({
      clock,
      ledger: new AlertLedger(memoryStorage()),
      show,
      timers: fakeTimers(),
    });
  });

  it("shows nothing before the early window, nothing inside it, exactly one at due, and no more inside grace", async () => {
    // Well before the 30-min early window.
    clock.set(plusMinutes(FIXTURE_NOW, -40));
    await scheduler.tick();
    expect(callsFor(show, courseId)).toHaveLength(0);

    // Inside the due-30min early window, but before the scheduled time.
    clock.set(plusMinutes(FIXTURE_NOW, -15));
    await scheduler.tick();
    expect(callsFor(show, courseId)).toHaveLength(0);

    // At the due time: exactly one.
    clock.set(FIXTURE_NOW);
    await scheduler.tick();
    expect(callsFor(show, courseId)).toHaveLength(1);

    // Further ticks inside the fixedTimes grace window (60 min): no more.
    clock.set(plusMinutes(FIXTURE_NOW, GRACE_FIXED_MIN - 10));
    await scheduler.tick();
    clock.set(plusMinutes(FIXTURE_NOW, GRACE_FIXED_MIN - 1));
    await scheduler.tick();
    expect(callsFor(show, courseId)).toHaveLength(1);
  });
});

// --- scheduler: fromLastDose, nothing before the chain starts --------------

describe("createNotificationScheduler — fromLastDose", () => {
  const START = "2026-08-08T00:00:00.000Z";
  let repo: Repo;
  let course: Course;
  let clock: ReturnType<typeof movableClock>;
  let show: ShowSpy;
  let scheduler: ReturnType<typeof createNotificationScheduler>;

  beforeEach(async () => {
    repo = createMemoryRepo();
    setRepo(repo);
    const [pet] = await repo.listPets();
    const [medication] = await repo.listMedications();
    course = await repo.createCourse({
      petId: pet.id,
      medicationId: medication.id,
      doseAmount: 1,
      doseUnit: "ml",
      instructions: null,
      schedule: { kind: "fromLastDose", intervalHours: 4 },
      startDate: "2026-08-08",
      endDate: null,
      notes: null,
    });
    clock = movableClock(START);
    show = fakeShow();
    scheduler = createNotificationScheduler({
      clock,
      ledger: new AlertLedger(memoryStorage()),
      show,
      timers: fakeTimers(),
    });
  });

  it("alerts once when lastGivenAt + intervalHours is reached, and never before the chain starts", async () => {
    // Chain never started (SPEC §3b): nothing due, at several points in time.
    clock.set(START);
    await scheduler.tick();
    expect(callsFor(show, course.id)).toHaveLength(0);

    clock.set(plusMinutes(START, 6 * 60));
    await scheduler.tick();
    expect(callsFor(show, course.id)).toHaveLength(0);

    // Start the chain.
    const givenAt = plusMinutes(START, 60);
    await repo.logDose({ courseId: course.id, status: "given", scheduledFor: null, amount: 1, givenAt });
    const dueAt = plusMinutes(givenAt, 4 * 60);

    // Before due: still nothing.
    clock.set(plusMinutes(dueAt, -10));
    await scheduler.tick();
    expect(callsFor(show, course.id)).toHaveLength(0);

    // At due: exactly one.
    clock.set(dueAt);
    await scheduler.tick();
    expect(callsFor(show, course.id)).toHaveLength(1);
  });
});

// --- scheduler: never more than two per dose, under every ordering ---------

describe("createNotificationScheduler — never more than two per dose", () => {
  let repo: Repo;
  let courseId: string;
  let key: string;
  let clock: ReturnType<typeof movableClock>;
  let ledger: AlertLedger;
  let show: ShowSpy;
  let scheduler: ReturnType<typeof createNotificationScheduler>;

  beforeEach(async () => {
    repo = createMemoryRepo();
    setRepo(repo);
    courseId = (await findCloverMetacamCourse(repo)).id;
    key = occurrenceKeyFor(courseId, FIXTURE_NOW);
    clock = movableClock(FIXTURE_NOW);
    ledger = new AlertLedger(memoryStorage());
    show = fakeShow();
    scheduler = createNotificationScheduler({ clock, ledger, show, timers: fakeTimers() });
  });

  it("(a) due, then overdue, then a snooze attempt: stops at two", async () => {
    clock.set(FIXTURE_NOW);
    await scheduler.tick(); // due
    clock.set(plusMinutes(FIXTURE_NOW, GRACE_FIXED_MIN + 30));
    await scheduler.tick(); // overdue
    expect(callsFor(show, courseId)).toHaveLength(2);

    const nowMs = clock.now().getTime();
    expect(ledger.snooze(key, nowMs)).toBe(false); // budget already spent

    clock.set(plusMinutes(FIXTURE_NOW, GRACE_FIXED_MIN + 90));
    await scheduler.tick();
    expect(callsFor(show, courseId)).toHaveLength(2);
    expect(show).not.toHaveBeenCalledTimes(3);
  });

  it("(b) due, then snooze, then the overdue window: stops at two", async () => {
    clock.set(FIXTURE_NOW);
    await scheduler.tick(); // due
    expect(ledger.snooze(key, clock.now().getTime())).toBe(true);

    clock.set(plusMinutes(FIXTURE_NOW, 30)); // snooze elapses
    await scheduler.tick();
    expect(callsFor(show, courseId)).toHaveLength(2); // due + snooze

    // Well past the grace/overdue window — the ceiling still refuses.
    clock.set(plusMinutes(FIXTURE_NOW, GRACE_FIXED_MIN + 60));
    await scheduler.tick();
    expect(callsFor(show, courseId)).toHaveLength(2);
    expect(show).not.toHaveBeenCalledTimes(3);
  });

  it("(c) a second snooze claimed after a snooze changes nothing", async () => {
    clock.set(FIXTURE_NOW);
    await scheduler.tick(); // due
    expect(ledger.snooze(key, clock.now().getTime())).toBe(true);

    clock.set(plusMinutes(FIXTURE_NOW, 30));
    await scheduler.tick(); // snooze re-alert
    expect(callsFor(show, courseId)).toHaveLength(2);

    const before = ledger.recordFor(key);
    expect(ledger.snooze(key, clock.now().getTime())).toBe(false); // proves the refusal
    expect(ledger.recordFor(key)).toEqual(before);

    clock.set(plusMinutes(FIXTURE_NOW, 45));
    await scheduler.tick();
    expect(callsFor(show, courseId)).toHaveLength(2);
  });

  it("(d) a very long run of ticks over several hours after both alerts fired: stays at two", async () => {
    clock.set(FIXTURE_NOW);
    await scheduler.tick(); // due
    clock.set(plusMinutes(FIXTURE_NOW, GRACE_FIXED_MIN + 5));
    await scheduler.tick(); // overdue
    expect(callsFor(show, courseId)).toHaveLength(2);

    for (let h = 1; h <= 10; h += 1) {
      clock.set(plusMinutes(FIXTURE_NOW, h * 60));
      await scheduler.tick();
    }
    expect(callsFor(show, courseId)).toHaveLength(2);
    expect(show).not.toHaveBeenCalledTimes(3);
  });
});

// --- scheduler: a reload does not grant fresh alerts ------------------------

describe("createNotificationScheduler — reload does not reset the ceiling", () => {
  it("a new scheduler and a new AlertLedger over the SAME storage still refuse after two alerts", async () => {
    const repo = createMemoryRepo();
    setRepo(repo);
    const courseId = (await findCloverMetacamCourse(repo)).id;
    const storage = memoryStorage();
    const clock = movableClock(FIXTURE_NOW);

    const ledger1 = new AlertLedger(storage);
    const show1 = fakeShow();
    const scheduler1 = createNotificationScheduler({ clock, ledger: ledger1, show: show1, timers: fakeTimers() });

    clock.set(FIXTURE_NOW);
    await scheduler1.tick();
    clock.set(plusMinutes(FIXTURE_NOW, GRACE_FIXED_MIN + 30));
    await scheduler1.tick();
    expect(callsFor(show1, courseId)).toHaveLength(2);

    // Simulate a reload: fresh AlertLedger AND fresh scheduler, same backing storage.
    const ledger2 = new AlertLedger(storage);
    const show2 = fakeShow();
    const scheduler2 = createNotificationScheduler({ clock, ledger: ledger2, show: show2, timers: fakeTimers() });

    clock.set(plusMinutes(FIXTURE_NOW, GRACE_FIXED_MIN + 120));
    await scheduler2.tick();
    expect(callsFor(show2, courseId)).toHaveLength(0);
  });
});

// --- scheduler: exact copy ---------------------------------------------------

describe("createNotificationScheduler — copy", () => {
  it("shows the exact SPEC §7 title for the Clover/Metacam fixture", async () => {
    const repo = createMemoryRepo();
    setRepo(repo);
    const course = await findCloverMetacamCourse(repo);
    const clock = movableClock(FIXTURE_NOW);
    const show = fakeShow();
    const scheduler = createNotificationScheduler({
      clock,
      ledger: new AlertLedger(memoryStorage()),
      show,
      timers: fakeTimers(),
    });

    await scheduler.tick();

    const [spec] = callsFor(show, course.id);
    expect(spec).toBeDefined();
    expect(spec.title).toBe("Clover · Metacam 0.4 ml due now");
    expect(spec.reason).toBe("due");
    expect(spec.tag).toBe(occurrenceKeyFor(course.id, FIXTURE_NOW));
    expect(spec.dose).toEqual({
      occurrenceKey: occurrenceKeyFor(course.id, FIXTURE_NOW),
      courseId: course.id,
      scheduledFor: FIXTURE_NOW,
      amount: 0.4,
    });
  });
});

// --- scheduler + performGive: Give stops further alerts ---------------------

describe("createNotificationScheduler — Give stops further alerts", () => {
  it("performGive logs a real DoseEvent and the scheduler then stops alerting (state becomes 'given')", async () => {
    const repo = createMemoryRepo();
    setRepo(repo);
    const courseId = (await findCloverMetacamCourse(repo)).id;
    const clock = movableClock(FIXTURE_NOW);
    const ledger = new AlertLedger(memoryStorage());
    const show = fakeShow();
    const scheduler = createNotificationScheduler({ clock, ledger, show, timers: fakeTimers() });
    const deps: ActionDeps = { ledger, clock };

    await scheduler.tick();
    const [spec] = callsFor(show, courseId);
    expect(spec).toBeDefined();

    await performGive(spec.dose, deps);

    const events = await repo.listDoseEvents({ courseId });
    const created = events.find((e) => e.occurrenceKey === spec.dose.occurrenceKey);
    expect(created).toBeDefined();
    expect(created!.status).toBe("given");
    expect(created!.actorId).toBe(await repo.currentActorId());

    show.mockClear();
    // Past the grace window — would have been the "overdue" re-alert, except
    // the dose is now `given`.
    clock.set(plusMinutes(FIXTURE_NOW, GRACE_FIXED_MIN + 30));
    await scheduler.tick();
    expect(callsFor(show, courseId)).toHaveLength(0);
  });
});

// --- scheduler + performSnooze -----------------------------------------------

describe("createNotificationScheduler — Snooze via performSnooze", () => {
  it("re-alerts once at +30 minutes and no more", async () => {
    const repo = createMemoryRepo();
    setRepo(repo);
    const courseId = (await findCloverMetacamCourse(repo)).id;
    const clock = movableClock(FIXTURE_NOW);
    const ledger = new AlertLedger(memoryStorage());
    const show = fakeShow();
    const scheduler = createNotificationScheduler({ clock, ledger, show, timers: fakeTimers() });
    const deps: ActionDeps = { ledger, clock };

    await scheduler.tick();
    const [dueSpec] = callsFor(show, courseId);
    expect(dueSpec).toBeDefined();
    show.mockClear();

    await performSnooze(dueSpec.dose, deps);

    clock.set(plusMinutes(FIXTURE_NOW, 10));
    await scheduler.tick();
    expect(callsFor(show, courseId)).toHaveLength(0); // before the snooze elapses

    clock.set(plusMinutes(FIXTURE_NOW, 30));
    await scheduler.tick();
    expect(callsFor(show, courseId)).toHaveLength(1); // exactly one re-alert

    clock.set(plusMinutes(FIXTURE_NOW, 120));
    await scheduler.tick();
    expect(callsFor(show, courseId)).toHaveLength(1); // no more — budget spent
  });

  it("a snooze attempted once both alerts are used changes nothing and shows nothing", async () => {
    const repo = createMemoryRepo();
    setRepo(repo);
    const courseId = (await findCloverMetacamCourse(repo)).id;
    const clock = movableClock(FIXTURE_NOW);
    const ledger = new AlertLedger(memoryStorage());
    const show = fakeShow();
    const scheduler = createNotificationScheduler({ clock, ledger, show, timers: fakeTimers() });
    const deps: ActionDeps = { ledger, clock };

    await scheduler.tick(); // due
    clock.set(plusMinutes(FIXTURE_NOW, GRACE_FIXED_MIN + 30));
    await scheduler.tick(); // overdue
    const dose = callsFor(show, courseId)[0].dose;
    expect(callsFor(show, courseId)).toHaveLength(2);
    show.mockClear();

    const before = ledger.recordFor(dose.occurrenceKey);
    await performSnooze(dose, deps);
    expect(ledger.recordFor(dose.occurrenceKey)).toEqual(before);

    clock.set(plusMinutes(FIXTURE_NOW, GRACE_FIXED_MIN + 200));
    await scheduler.tick();
    expect(callsFor(show, courseId)).toHaveLength(0);
  });
});

// --- scheduler: canNotify / prune / throwing tick ----------------------------

describe("createNotificationScheduler — tick behaviour", () => {
  it("prunes the ledger even when canNotify() is false, and does no reads or shows", async () => {
    const repo = createMemoryRepo();
    setRepo(repo);
    const listCoursesSpy = vi.spyOn(repo, "listCourses");
    const clock = movableClock(FIXTURE_NOW);
    const ledger = new AlertLedger(memoryStorage());
    const pruneSpy = vi.spyOn(ledger, "prune");
    const show = fakeShow();
    const scheduler = createNotificationScheduler({
      clock,
      ledger,
      show,
      timers: fakeTimers(),
      canNotify: () => false,
    });

    await scheduler.tick();

    expect(pruneSpy).toHaveBeenCalledWith(new Date(FIXTURE_NOW).getTime());
    expect(listCoursesSpy).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
  });

  it("a throwing tick does not kill the loop and does not log", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const repo = createMemoryRepo();
    repo.listCourses = vi.fn().mockRejectedValue(new Error("boom"));
    setRepo(repo);

    const scheduler = createNotificationScheduler({
      clock: movableClock(FIXTURE_NOW),
      ledger: new AlertLedger(memoryStorage()),
      show: fakeShow(),
      timers: fakeTimers(),
    });

    await expect(scheduler.tick()).resolves.toBeUndefined();

    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });
});

// --- scheduler: start/stop wiring -------------------------------------------

describe("createNotificationScheduler — start/stop", () => {
  let originalVisibilityDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalVisibilityDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState");
  });

  afterEach(() => {
    if (originalVisibilityDescriptor) {
      Object.defineProperty(document, "visibilityState", originalVisibilityDescriptor);
    }
  });

  it("schedules ticks via the injected timers at POLL_INTERVAL_MS, and stop() clears them", () => {
    const setTimeoutSpy = vi.fn().mockReturnValue(123 as unknown as ReturnType<typeof setTimeout>);
    const clearTimeoutSpy = vi.fn();
    const scheduler = createNotificationScheduler({
      clock: movableClock(FIXTURE_NOW),
      ledger: new AlertLedger(memoryStorage()),
      show: fakeShow(),
      timers: {
        setTimeout: setTimeoutSpy as unknown as typeof setTimeout,
        clearTimeout: clearTimeoutSpy as unknown as typeof clearTimeout,
      },
    });

    scheduler.start();
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), POLL_INTERVAL_MS);

    scheduler.stop();
    expect(clearTimeoutSpy).toHaveBeenCalledWith(123);
  });

  it("re-ticks on visibilitychange when the document becomes visible", async () => {
    const repo = createMemoryRepo();
    setRepo(repo);
    const courseId = (await findCloverMetacamCourse(repo)).id;
    const show = fakeShow();
    const scheduler = createNotificationScheduler({
      clock: movableClock(FIXTURE_NOW),
      ledger: new AlertLedger(memoryStorage()),
      show,
      timers: fakeTimers(),
    });

    scheduler.start();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));

    await vi.waitFor(() => expect(callsFor(show, courseId)).toHaveLength(1));

    scheduler.stop();
  });
});
