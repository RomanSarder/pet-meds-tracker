import { describe, it, expect } from "vitest";
import { occurrenceKeyFor } from "./keys";
import { fixtures } from "./fixtures";
import { createMemoryRepo } from "@/data/memoryRepo";

describe("occurrenceKeyFor", () => {
  it("joins courseId and scheduledFor with a pipe when scheduledFor is set", () => {
    expect(occurrenceKeyFor("course-1", "2026-08-06T07:00:00.000Z")).toBe(
      "course-1|2026-08-06T07:00:00.000Z",
    );
  });

  it("falls back to \"-\" when scheduledFor is null", () => {
    expect(occurrenceKeyFor("course-1", null)).toBe("course-1|-");
  });
});

describe("occurrenceKeyFor — DoseEvent/Occurrence join", () => {
  it("agrees between the DoseEvent side and the Occurrence side for a never-started fromLastDose course", async () => {
    // Find the fixtures' never-started fromLastDose course: the one no
    // "given" DoseEvent references (same predicate as fixtures.test.ts).
    // scheduledFor is null for this course until its first dose is logged.
    const fromLastDoseCourses = fixtures.courses.filter(
      (c) => c.schedule.kind === "fromLastDose",
    );
    const neverStarted = fromLastDoseCourses.filter(
      (c) => !fixtures.doseEvents.some((e) => e.courseId === c.id && e.status === "given"),
    );
    expect(neverStarted).toHaveLength(1);
    const course = neverStarted[0];

    // DoseEvent side: exercises the real data layer. memoryRepo.logDose
    // (frontend/src/data/memoryRepo.ts) builds occurrenceKey via
    // occurrenceKeyFor(input.courseId, input.scheduledFor); logging this
    // course's first-ever dose passes scheduledFor: null.
    const repo = createMemoryRepo();
    const doseEvent = await repo.logDose({
      courseId: course.id,
      status: "given",
      scheduledFor: null,
      amount: course.doseAmount,
    });
    const doseEventSideKey = doseEvent.occurrenceKey;

    // Occurrence side: validates the CONTRACT that both sides must satisfy,
    // not a live engine output. The engine stub cannot yet emit fromLastDose
    // occurrences (W2 slice 3 will add this); we call occurrenceKeyFor directly
    // to test the contract. W2 must construct Occurrence.key using this same
    // helper. The literal assertion below is the real guard; the equality check
    // alone is tautological since both operands derive from occurrenceKeyFor.
    const occurrenceSideKey = occurrenceKeyFor(course.id, null);

    expect(doseEventSideKey).toBe(occurrenceSideKey);
    // Literal assertion, not just equality: if both sides drifted together
    // to the same wrong fallback (e.g., an abandoned fallback like "interval"),
    // the equality check above would still pass. This pins the actual contracted
    // shape.
    expect(doseEventSideKey).toBe(`${course.id}|-`);
  });
});
