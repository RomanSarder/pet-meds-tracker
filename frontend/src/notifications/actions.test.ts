// Give and Snooze, performed in the page. The load-bearing claim for Give is
// SPEC §11's slice-3 contract read the other way round: the write goes
// through the repository exactly like the Today screen, so the dedup guard
// and actor stamping apply unchanged — never a hand-built `DoseEvent`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Course } from "@/domain";
import { fixedClock, occurrenceKeyFor } from "@/domain";
import { setRepo, type Repo } from "@/data";
import { createMemoryRepo } from "@/data/memoryRepo";
import { performGive, performSnooze, type ActionDeps } from "./actions";
import { AlertLedger, SNOOZE_MINUTES, type LedgerStorage } from "./ledger";
import type { DoseRef } from "./types";

const NOW = "2026-08-08T08:00:00.000Z";

function memoryLedgerStorage(): LedgerStorage {
  let value: string | null = null;
  return {
    read: () => value,
    write: (v: string) => {
      value = v;
    },
  };
}

function makeDeps(): ActionDeps {
  return { ledger: new AlertLedger(memoryLedgerStorage()), clock: fixedClock(NOW) };
}

/** The Clover/Metacam fixedTimes course; its 08:00 BST today dose is unlogged in the fixtures. */
async function findGivableCourse(repo: Repo): Promise<Course> {
  const courses = await repo.listCourses();
  const course = courses.find(
    (c) => c.status === "active" && c.schedule.kind === "fixedTimes" && c.schedule.times.includes("08:00"),
  );
  if (!course) throw new Error("fixture drift: no active 08:00 fixedTimes course");
  return course;
}

const SCHEDULED_FOR = "2026-08-08T07:00:00.000Z";

describe("performGive", () => {
  let repo: Repo;

  beforeEach(() => {
    repo = createMemoryRepo();
    setRepo(repo);
  });

  it("writes a real DoseEvent reachable through repo.listDoseEvents, with the repo-stamped actorId", async () => {
    const course = await findGivableCourse(repo);
    const dose: DoseRef = {
      occurrenceKey: occurrenceKeyFor(course.id, SCHEDULED_FOR),
      courseId: course.id,
      scheduledFor: SCHEDULED_FOR,
      amount: course.doseAmount,
    };
    const before = await repo.listDoseEvents({ courseId: course.id });

    await performGive(dose, makeDeps());

    const after = await repo.listDoseEvents({ courseId: course.id });
    const created = after.filter((e) => !before.some((b) => b.id === e.id));
    expect(created).toHaveLength(1);

    // The caller (performGive) never supplied an actorId — this is the
    // repo's own stamp for an ordinary log, asserted independently.
    const expectedActorId = await repo.currentActorId();
    expect(created[0].actorId).toBe(expectedActorId);
    expect(created[0]).toMatchObject({
      courseId: course.id,
      status: "given",
      scheduledFor: SCHEDULED_FOR,
      amount: course.doseAmount,
      occurrenceKey: dose.occurrenceKey,
    });
  });

  it("calls repo.logDose rather than any lower-level API", async () => {
    const course = await findGivableCourse(repo);
    const logDoseSpy = vi.spyOn(repo, "logDose");
    const dose: DoseRef = {
      occurrenceKey: occurrenceKeyFor(course.id, SCHEDULED_FOR),
      courseId: course.id,
      scheduledFor: SCHEDULED_FOR,
      amount: course.doseAmount,
    };

    await performGive(dose, makeDeps());

    expect(logDoseSpy).toHaveBeenCalledTimes(1);
    expect(logDoseSpy).toHaveBeenCalledWith({
      courseId: course.id,
      status: "given",
      scheduledFor: SCHEDULED_FOR,
      amount: course.doseAmount,
    });
  });

  it("swallows a repo failure silently", async () => {
    const course = await findGivableCourse(repo);
    repo.logDose = vi.fn().mockRejectedValue(new Error("write failed"));
    const dose: DoseRef = {
      occurrenceKey: occurrenceKeyFor(course.id, SCHEDULED_FOR),
      courseId: course.id,
      scheduledFor: SCHEDULED_FOR,
      amount: course.doseAmount,
    };

    await expect(performGive(dose, makeDeps())).resolves.toBeUndefined();
  });

  it("resolves amount freshly, so an edited course wins over a stale dose.amount", async () => {
    const course = await findGivableCourse(repo);
    await repo.updateCourse(course.id, { doseAmount: 0.9 });
    const dose: DoseRef = {
      occurrenceKey: occurrenceKeyFor(course.id, SCHEDULED_FOR),
      courseId: course.id,
      scheduledFor: SCHEDULED_FOR,
      amount: 0.4, // stale — the amount the notification was built with
    };

    await performGive(dose, makeDeps());

    const events = await repo.listDoseEvents({ courseId: course.id });
    const created = events.find((e) => e.occurrenceKey === dose.occurrenceKey);
    expect(created?.amount).toBe(0.9);
  });

  it("falls back to dose.amount when the occurrence can no longer be found", async () => {
    const dose: DoseRef = {
      occurrenceKey: occurrenceKeyFor("no-such-course", SCHEDULED_FOR),
      courseId: "no-such-course",
      scheduledFor: SCHEDULED_FOR,
      amount: 0.7,
    };
    const logDoseSpy = vi.spyOn(repo, "logDose");

    await performGive(dose, makeDeps());

    // The repo itself rejects an unknown courseId, so the call is expected to
    // have been attempted with the fallback amount and then swallowed.
    expect(logDoseSpy).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: "no-such-course", amount: 0.7 }),
    );
  });
});

describe("performSnooze", () => {
  beforeEach(() => {
    setRepo(createMemoryRepo());
  });

  it("records a snooze via the ledger and does nothing else", async () => {
    const repo = createMemoryRepo();
    setRepo(repo);
    const deps = makeDeps();
    const dose: DoseRef = {
      occurrenceKey: occurrenceKeyFor("course-x", SCHEDULED_FOR),
      courseId: "course-x",
      scheduledFor: SCHEDULED_FOR,
      amount: 1,
    };

    const before = await repo.listDoseEvents({});
    await performSnooze(dose, deps);
    const after = await repo.listDoseEvents({});
    expect(after).toEqual(before);

    const record = deps.ledger.recordFor(dose.occurrenceKey);
    expect(record?.snoozeUntil).toBe(deps.clock.now().getTime() + SNOOZE_MINUTES * 60_000);
  });

  it("is a silent no-op when the ledger refuses", async () => {
    const deps = makeDeps();
    const dose: DoseRef = {
      occurrenceKey: occurrenceKeyFor("course-y", SCHEDULED_FOR),
      courseId: "course-y",
      scheduledFor: SCHEDULED_FOR,
      amount: 1,
    };
    const nowMs = deps.clock.now().getTime();
    // Prove the refusal would otherwise have fired: exhaust the alert budget
    // first, so `ledger.snooze` itself returns false.
    expect(deps.ledger.claim(dose.occurrenceKey, "due", nowMs)).toBe(true);
    expect(deps.ledger.claim(dose.occurrenceKey, "overdue", nowMs)).toBe(true);
    expect(deps.ledger.snooze(dose.occurrenceKey, nowMs)).toBe(false);

    await expect(performSnooze(dose, deps)).resolves.toBeUndefined();
    expect(deps.ledger.recordFor(dose.occurrenceKey)?.snoozeUntil).toBeNull();
  });
});
