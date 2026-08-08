import { describe, it, expect } from "vitest";
import { cloneFixtures, fixtures } from "./fixtures";

describe("fixtures", () => {
  it("resolves every course's petId and medicationId", () => {
    const petIds = new Set(fixtures.pets.map((p) => p.id));
    const medicationIds = new Set(fixtures.medications.map((m) => m.id));
    for (const course of fixtures.courses) {
      expect(petIds.has(course.petId)).toBe(true);
      expect(medicationIds.has(course.medicationId)).toBe(true);
    }
  });

  it("shares Ivermectin across exactly two courses on two different pets", () => {
    const ivermectin = fixtures.medications.find((m) => m.name === "Ivermectin");
    expect(ivermectin).toBeDefined();
    const usingCourses = fixtures.courses.filter(
      (c) => c.medicationId === ivermectin?.id,
    );
    expect(usingCourses).toHaveLength(2);
    const petIds = new Set(usingCourses.map((c) => c.petId));
    expect(petIds.size).toBe(2);
  });

  it("includes at least one course of each schedule kind", () => {
    expect(fixtures.courses.some((c) => c.schedule.kind === "fixedTimes")).toBe(true);
    expect(fixtures.courses.some((c) => c.schedule.kind === "fromLastDose")).toBe(true);
  });

  it("has exactly one fromLastDose course with zero given events", () => {
    const fromLastDoseCourses = fixtures.courses.filter(
      (c) => c.schedule.kind === "fromLastDose",
    );
    const neverStarted = fromLastDoseCourses.filter(
      (c) =>
        !fixtures.doseEvents.some(
          (e) => e.courseId === c.id && e.status === "given",
        ),
    );
    expect(neverStarted).toHaveLength(1);
  });

  it("includes a fixedTimes course with daysOfWeek and one with everyNDays", () => {
    const withDaysOfWeek = fixtures.courses.some(
      (c) => c.schedule.kind === "fixedTimes" && c.schedule.daysOfWeek !== undefined,
    );
    const withEveryNDays = fixtures.courses.some(
      (c) => c.schedule.kind === "fixedTimes" && c.schedule.everyNDays !== undefined,
    );
    expect(withDaysOfWeek).toBe(true);
    expect(withEveryNDays).toBe(true);
  });

  it("includes a course with an endDate and at least one non-active status", () => {
    expect(fixtures.courses.some((c) => c.endDate !== null)).toBe(true);
    expect(fixtures.courses.some((c) => c.status !== "active")).toBe(true);
  });

  it("keeps every medication's stockUnits equal to the sum of its StockAdjustment deltaUnits", () => {
    for (const medication of fixtures.medications) {
      const sum = fixtures.stockAdjustments
        .filter((s) => s.medicationId === medication.id)
        .reduce((total, s) => total + s.deltaUnits, 0);
      expect(medication.stockUnits).not.toBeNull();
      expect(medication.stockUnits).toBeCloseTo(sum, 10);
    }
  });

  it("gives every DoseEvent an occurrenceKey matching `${courseId}|${scheduledFor ?? \"-\"}`", () => {
    for (const event of fixtures.doseEvents) {
      const expected = `${event.courseId}|${event.scheduledFor ?? "-"}`;
      expect(event.occurrenceKey).toBe(expected);
    }
  });

  it("includes at least one given, one skipped and one missed DoseEvent", () => {
    expect(fixtures.doseEvents.some((e) => e.status === "given")).toBe(true);
    expect(fixtures.doseEvents.some((e) => e.status === "skipped")).toBe(true);
    expect(fixtures.doseEvents.some((e) => e.status === "missed")).toBe(true);
  });

  it("sets deletedAt to null on every seeded row", () => {
    for (const collection of [
      fixtures.pets,
      fixtures.medications,
      fixtures.courses,
      fixtures.doseEvents,
      fixtures.stockAdjustments,
    ]) {
      for (const row of collection) {
        expect(row.deletedAt).toBeNull();
      }
    }
  });
});

describe("cloneFixtures", () => {
  it("returns a structure that is deep-equal but not reference-equal", () => {
    const clone = cloneFixtures();
    expect(clone).toEqual(fixtures);
    expect(clone).not.toBe(fixtures);
    expect(clone.pets).not.toBe(fixtures.pets);
    expect(clone.pets[0]).not.toBe(fixtures.pets[0]);
    expect(clone.courses[0].schedule).not.toBe(fixtures.courses[0].schedule);
  });

  it("does not let a mutation of the clone affect the shared constant", () => {
    const clone = cloneFixtures();
    clone.pets[0].name = "Mutated";
    expect(fixtures.pets[0].name).toBe("Clover");
  });
});
