// Pure-function tests for the shared live-event resolution rule (SPEC §8):
// among the DoseEvents sharing an occurrenceKey, the live one is the newest
// by `loggedAt` that no other event supersedes. No IDB, no clock — these are
// plain arrays in, plain values out.
import { describe, expect, it } from "vitest";
import type { DoseEvent } from "@/domain";
import { liveDoseEvent, liveDoseEvents } from "../doseEvents";

function mkEvent(overrides: Partial<DoseEvent> & { id: string; occurrenceKey: string }): DoseEvent {
  return {
    courseId: "course-1",
    scheduledFor: null,
    status: "given",
    loggedAt: "2026-08-08T07:00:00.000Z",
    givenAt: "2026-08-08T07:00:00.000Z",
    amount: 1,
    note: null,
    supersedesId: null,
    actorId: "test-actor-id",
    createdAt: "2026-08-08T07:00:00.000Z",
    updatedAt: "2026-08-08T07:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

describe("liveDoseEvent", () => {
  it("returns the single event for an occurrenceKey with no corrections", () => {
    const o = mkEvent({ id: "o1", occurrenceKey: "k1", loggedAt: "2026-08-08T07:00:00.000Z" });
    expect(liveDoseEvent([o], "k1")).toEqual(o);
  });

  it("returns the correction, not the original, when an event has one correction", () => {
    const original = mkEvent({ id: "o1", occurrenceKey: "k1", loggedAt: "2026-08-08T07:00:00.000Z" });
    const correction = mkEvent({
      id: "c1",
      occurrenceKey: "k1",
      loggedAt: "2026-08-08T07:05:00.000Z",
      supersedesId: "o1",
    });
    expect(liveDoseEvent([original, correction], "k1")?.id).toBe("c1");
  });

  it("returns the last event in a chain of two corrections", () => {
    const original = mkEvent({ id: "o1", occurrenceKey: "k1", loggedAt: "2026-08-08T07:00:00.000Z" });
    const c1 = mkEvent({
      id: "c1",
      occurrenceKey: "k1",
      loggedAt: "2026-08-08T07:05:00.000Z",
      supersedesId: "o1",
    });
    const c2 = mkEvent({
      id: "c2",
      occurrenceKey: "k1",
      loggedAt: "2026-08-08T07:10:00.000Z",
      supersedesId: "c1",
    });
    expect(liveDoseEvent([original, c1, c2], "k1")?.id).toBe("c2");
  });

  it("excludes a superseded row even when it has a newer loggedAt than the actual live row", () => {
    // A pathological but possible input: the row that supersedes `original`
    // (A) has a *later* loggedAt than the row that in turn supersedes A (B).
    // A naive "pick the max loggedAt" implementation would wrongly return A;
    // the correct rule excludes any superseded row outright, regardless of
    // its timestamp rank.
    const original = mkEvent({ id: "o1", occurrenceKey: "k1", loggedAt: "2026-08-08T07:00:00.000Z" });
    const a = mkEvent({
      id: "a1",
      occurrenceKey: "k1",
      loggedAt: "2026-08-08T07:30:00.000Z", // newest by loggedAt...
      supersedesId: "o1",
    });
    const b = mkEvent({
      id: "b1",
      occurrenceKey: "k1",
      loggedAt: "2026-08-08T07:10:00.000Z", // ...but b supersedes a and is the true live row
      supersedesId: "a1",
    });
    expect(liveDoseEvent([original, a, b], "k1")?.id).toBe("b1");
  });

  it("breaks a tie on equal loggedAt by the lexicographically greatest id", () => {
    const e1 = mkEvent({ id: "aaa", occurrenceKey: "k1", loggedAt: "2026-08-08T07:00:00.000Z" });
    const e2 = mkEvent({ id: "zzz", occurrenceKey: "k1", loggedAt: "2026-08-08T07:00:00.000Z" });
    expect(liveDoseEvent([e1, e2], "k1")?.id).toBe("zzz");
    expect(liveDoseEvent([e2, e1], "k1")?.id).toBe("zzz");
  });

  it("ignores soft-deleted rows", () => {
    const original = mkEvent({ id: "o1", occurrenceKey: "k1", loggedAt: "2026-08-08T07:00:00.000Z" });
    const deletedCorrection = mkEvent({
      id: "c1",
      occurrenceKey: "k1",
      loggedAt: "2026-08-08T07:05:00.000Z",
      supersedesId: "o1",
      deletedAt: "2026-08-08T08:00:00.000Z",
    });
    expect(liveDoseEvent([original, deletedCorrection], "k1")?.id).toBe("o1");
  });

  it("returns null for an occurrenceKey no event has", () => {
    const o = mkEvent({ id: "o1", occurrenceKey: "k1" });
    expect(liveDoseEvent([o], "unknown-key")).toBeNull();
  });
});

describe("liveDoseEvents", () => {
  it("returns exactly one live row per occurrenceKey", () => {
    const k1Original = mkEvent({ id: "o1", occurrenceKey: "k1", loggedAt: "2026-08-08T07:00:00.000Z" });
    const k1Correction = mkEvent({
      id: "c1",
      occurrenceKey: "k1",
      loggedAt: "2026-08-08T07:05:00.000Z",
      supersedesId: "o1",
    });
    const k2Single = mkEvent({ id: "o2", occurrenceKey: "k2", loggedAt: "2026-08-08T07:00:00.000Z" });
    const k3AllDeleted = mkEvent({
      id: "o3",
      occurrenceKey: "k3",
      loggedAt: "2026-08-08T07:00:00.000Z",
      deletedAt: "2026-08-08T08:00:00.000Z",
    });

    const result = liveDoseEvents([k1Original, k1Correction, k2Single, k3AllDeleted]);
    const byKey = new Map(result.map((e) => [e.occurrenceKey, e.id]));

    expect(result).toHaveLength(2);
    expect(byKey.get("k1")).toBe("c1");
    expect(byKey.get("k2")).toBe("o2");
    expect(byKey.has("k3")).toBe(false);
  });
});
