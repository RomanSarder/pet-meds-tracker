// Turns repo rows + projection maths into the exact SupplyRowProps the kit
// renders. See CONTRACT-supplies.md "features/supplies/model.ts — exact
// contract". Pure: no React, no repo access.
import type { Course, Medication, Pet, Schedule, StockAdjustment } from "@/domain";
import { forWhomLabel, neededLabel, runOutLabel, stockLabel, weeksOfCoverLabel } from "./labels";
import type { MedicationProjection, SupplyTone } from "./projection";
import { projectMedication } from "./projection";

export type SupplySort = "By urgency" | "By pet";
export const SUPPLY_SORTS: SupplySort[] = ["By urgency", "By pet"];

export interface SupplyItem {
  medicationId: string;
  /** SupplyRow `name` — the medication name alone. */
  name: string;
  forWhom: string;
  stock: string;
  tone: SupplyTone;
  /** undefined hides the meter (SupplyRow only renders the bar for a number). */
  percent: number | undefined;
  note: string | undefined;
  /** Pet names, in roster order, for the shopping list. */
  petNames: string[];
  projection: MedicationProjection;
  /** Group membership. */
  buyNow: boolean;
}

export function buildSupplyItems(input: {
  medications: Medication[];
  courses: Course[];
  pets: Pet[];
  adjustments: StockAdjustment[];
  now: Date;
}): SupplyItem[] {
  const { medications, courses, pets, adjustments, now } = input;

  // Only non-archived pets and non-soft-deleted rows participate.
  const livePets = pets.filter((p) => !p.archived && p.deletedAt === null);
  const liveCourses = courses.filter((c) => c.deletedAt === null);
  const liveAdjustments = adjustments.filter((a) => a.deletedAt === null);
  const liveMedications = medications.filter((m) => m.deletedAt === null);

  return liveMedications.map((medication) => {
    // A medication with no courses at all still appears — it is something
    // you own — so this is never filtered down to nothing.
    const medicationCourses = liveCourses.filter((c) => c.medicationId === medication.id);
    const medicationAdjustments = liveAdjustments.filter(
      (a) => a.medicationId === medication.id,
    );

    const projection = projectMedication({
      medication,
      courses: medicationCourses,
      adjustments: medicationAdjustments,
      now,
    });

    // petNames: distinct pet names of this medication's ACTIVE courses, in
    // roster order (the order `pets` was supplied), not course order — so
    // Ivermectin's Nugget-then-Biscuit fixture order matches the roster
    // rather than whichever course happens to sort first.
    const activeCourses = medicationCourses.filter((c) => c.status === "active");
    const petNames: string[] = [];
    const schedules: Schedule[] = [];
    for (const pet of livePets) {
      const petCourses = activeCourses.filter((c) => c.petId === pet.id);
      if (petCourses.length === 0) continue;
      petNames.push(pet.name);
      for (const c of petCourses) schedules.push(c.schedule);
    }

    const forWhom = forWhomLabel(petNames, schedules);
    const stock = stockLabel(medication.stockUnits, medication.unit);
    const percent = projection.percent ?? undefined;
    const buyNow = projection.runsOutInsideHorizon;

    let note: string | undefined;
    if (projection.needsStockPrompt) {
      // Precedence 1 (SPEC §8 + §6.6): the stale-stock prompt sentence wins
      // over the buy-now run-out note. A run-out date already in the past
      // is not information once we are already asking "do you still have
      // this?" — so we replace the run-out clause rather than append to it,
      // keeping only the required quantity from §6.6 alongside it.
      note = `Still have ${medication.name}? Update stock. · need ${neededLabel(
        projection.neededPacks,
        projection.needed,
        medication.unit,
      )}`;
    } else if (buyNow) {
      // Precedence 2: the kit's own note format.
      note = `Runs out ${runOutLabel(projection.runOutDate as Date)} · need ${neededLabel(
        projection.neededPacks,
        projection.needed,
        medication.unit,
      )}`;
    } else if (projection.stockSet && projection.dailyUse > 0) {
      // Precedence 3: stocked, in-use medications report weeks of cover.
      note = weeksOfCoverLabel(projection.daysOfCover as number);
    } else {
      // Precedence 4: stock not set, or nothing is currently using it.
      note = undefined;
    }

    return {
      medicationId: medication.id,
      name: medication.name,
      forWhom,
      stock,
      tone: projection.tone,
      percent,
      note,
      petNames,
      projection,
      buyNow,
    };
  });
}

/** Ascending sort key for "By urgency": null/Infinite cover sorts last. */
function urgencyKey(daysOfCover: number | null): number {
  if (daysOfCover === null || daysOfCover === Infinity) return Number.POSITIVE_INFINITY;
  return daysOfCover;
}

export function sortSupplyItems(items: SupplyItem[], sort: SupplySort): SupplyItem[] {
  const sorted = [...items];
  if (sort === "By urgency") {
    sorted.sort((a, b) => {
      const delta = urgencyKey(a.projection.daysOfCover) - urgencyKey(b.projection.daysOfCover);
      return delta !== 0 ? delta : a.name.localeCompare(b.name);
    });
  } else {
    sorted.sort((a, b) => {
      const petCompare = (a.petNames[0] ?? "").localeCompare(b.petNames[0] ?? "");
      return petCompare !== 0 ? petCompare : a.name.localeCompare(b.name);
    });
  }
  // Sorting only reorders within the caller's list; group membership
  // (`buyNow`) is untouched, so the page's later split on it is stable.
  return sorted;
}
