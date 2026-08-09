// W9-DESIGN §D6 — `mapping.ts` maps every sync table field by field in both
// directions. A round trip through `*ToDto`/`*FromDto` for one row of each
// kind must reproduce the original (`householdId` aside, which never rides
// the wire and is reattached from the caller instead of the row).
import { describe, expect, it } from "vitest";
import { cloneFixtures } from "@/domain";
import {
  courseEventFromDto,
  courseEventToDto,
  courseFromDto,
  courseToDto,
  doseEventFromDto,
  doseEventToDto,
  medicationFromDto,
  medicationToDto,
  petFromDto,
  petToDto,
  stockAdjustmentFromDto,
  stockAdjustmentToDto,
} from "../mapping";

const fixtures = cloneFixtures();

describe("mapping round trips", () => {
  it("Pet survives toDto/fromDto aside from householdId, reattached from the caller", () => {
    const pet = fixtures.pets[0];
    const dto = petToDto(pet);
    expect(dto).not.toHaveProperty("householdId");
    expect(petFromDto(dto, pet.householdId)).toEqual(pet);
  });

  it("Medication round-trips exactly", () => {
    const medication = fixtures.medications[0];
    expect(medicationFromDto(medicationToDto(medication))).toEqual(medication);
  });

  it("Course (including its Schedule union) round-trips exactly, for both schedule kinds", () => {
    const fixedTimesCourse = fixtures.courses.find((c) => c.schedule.kind === "fixedTimes")!;
    const fromLastDoseCourse = fixtures.courses.find((c) => c.schedule.kind === "fromLastDose")!;
    expect(courseFromDto(courseToDto(fixedTimesCourse))).toEqual(fixedTimesCourse);
    expect(courseFromDto(courseToDto(fromLastDoseCourse))).toEqual(fromLastDoseCourse);
  });

  it("DoseEvent round-trips exactly", () => {
    const doseEvent = fixtures.doseEvents[0];
    expect(doseEventFromDto(doseEventToDto(doseEvent))).toEqual(doseEvent);
  });

  it("StockAdjustment round-trips exactly", () => {
    const adjustment = fixtures.stockAdjustments[0];
    expect(stockAdjustmentFromDto(stockAdjustmentToDto(adjustment))).toEqual(adjustment);
  });

  it("CourseEvent round-trips exactly, including a null `before` (the 'started' case)", () => {
    const event = {
      id: "z0000000-0000-4000-8000-0000000000e1",
      courseId: fixtures.courses[0].id,
      kind: "started" as const,
      at: "2026-08-06T08:00:00.000Z",
      actorId: fixtures.users[0].id,
      before: null,
      after: {
        schedule: fixtures.courses[0].schedule,
        doseAmount: fixtures.courses[0].doseAmount,
        doseUnit: fixtures.courses[0].doseUnit,
        startDate: fixtures.courses[0].startDate,
        endDate: fixtures.courses[0].endDate,
      },
      seq: 1,
      createdAt: "2026-08-06T08:00:00.000Z",
      updatedAt: "2026-08-06T08:00:00.000Z",
      deletedAt: null,
    };
    expect(courseEventFromDto(courseEventToDto(event))).toEqual(event);
  });
});
