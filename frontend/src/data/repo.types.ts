// The `Repo` interface — the contract every UI-facing worker builds against.
// W1 (slice 2) implements `createIdbRepo()` against this same interface; this
// branch (W0) ships `createMemoryRepo()` as the interim (and permanent test)
// implementation. Signatures here are reproduced VERBATIM from the W0
// foundations brief §4 — do not "fix" anything here without raising it, since
// four other branches import this file.
import type {
  Course,
  CourseStatus,
  DoseEvent,
  DoseEventStatus,
  HouseholdBackup,
  ImportReport,
  IsoDateTime,
  LocalDate,
  Medication,
  MedicationForm,
  MetaShape,
  Pet,
  Species,
  StockAdjustment,
  StockReason,
  Timestamped,
} from "@/domain";

/**
 * Append-only is enforced by the SHAPE of this interface, not by discipline:
 * there is deliberately no `updateDoseEvent`, no `deleteDoseEvent`, and no
 * `updateStockAdjustment`. `DoseEvent` and `StockAdjustment` rows are only
 * ever created (`logDose`, `correctDose`, `recordMissed`, `adjustStock`,
 * `setStockOnHand`) or — for the single, bounded, brief-§7-item-1 exception —
 * hard-deleted via `retractDoseEvent`. Do not add mutator methods for these
 * two entities; a caller that wants to "edit" a dose event must append a
 * correction instead.
 */
export interface Repo {
  listPets(opts?: { includeArchived?: boolean }): Promise<Pet[]>;
  getPet(id: string): Promise<Pet | null>;
  createPet(input: {
    name: string;
    species: Species;
    birthdate?: LocalDate | null;
    weightGrams?: number | null;
  }): Promise<Pet>; // assigns tint
  updatePet(
    id: string,
    patch: Partial<Pick<Pet, "name" | "species" | "birthdate" | "weightGrams">>,
  ): Promise<Pet>;
  setPetArchived(id: string, archived: boolean): Promise<Pet>;
  softDeletePet(id: string): Promise<void>;

  listMedications(): Promise<Medication[]>;
  getMedication(id: string): Promise<Medication | null>;
  findMedicationByName(name: string): Promise<Medication | null>; // case-insensitive
  createMedication(input: {
    name: string;
    form: MedicationForm;
    unit: string;
    strength?: string | null;
    packSize?: number | null;
    lowThreshold?: number | null;
  }): Promise<Medication>;
  updateMedication(
    id: string,
    patch: Partial<Omit<Medication, "id" | "stockUnits" | keyof Timestamped>>,
  ): Promise<Medication>;

  listCourses(filter?: {
    petId?: string;
    medicationId?: string;
    status?: CourseStatus[];
  }): Promise<Course[]>;
  getCourse(id: string): Promise<Course | null>;
  createCourse(
    input: Omit<Course, "id" | "status" | "resumedAt" | keyof Timestamped> & {
      status?: CourseStatus;
    },
  ): Promise<Course>;
  updateCourse(
    id: string,
    patch: Partial<
      Pick<
        Course,
        "doseAmount" | "doseUnit" | "instructions" | "schedule" | "startDate" | "endDate" | "notes"
      >
    >,
  ): Promise<Course>;
  setCourseStatus(id: string, status: CourseStatus): Promise<Course>;

  listDoseEvents(filter: {
    courseId?: string;
    courseIds?: string[];
    from?: IsoDateTime;
    to?: IsoDateTime;
    limit?: number;
    newestFirst?: boolean;
  }): Promise<DoseEvent[]>;
  logDose(input: {
    courseId: string;
    status: "given" | "skipped";
    scheduledFor: IsoDateTime | null;
    givenAt?: IsoDateTime;
    amount: number;
    note?: string;
  }): Promise<DoseEvent>;
  correctDose(
    originalId: string,
    patch: {
      givenAt?: IsoDateTime;
      amount?: number;
      status?: DoseEventStatus;
      note?: string;
    },
  ): Promise<DoseEvent>;
  retractDoseEvent(id: string): Promise<void>;
  recordMissed(
    inputs: Array<{ courseId: string; scheduledFor: IsoDateTime; amount: number }>,
  ): Promise<DoseEvent[]>;

  listStockAdjustments(medicationId?: string): Promise<StockAdjustment[]>;
  adjustStock(input: {
    medicationId: string;
    deltaUnits: number;
    reason: StockReason;
    note?: string;
  }): Promise<StockAdjustment>;
  setStockOnHand(medicationId: string, units: number, note?: string): Promise<StockAdjustment>;

  exportHousehold(): Promise<HouseholdBackup>;
  importHousehold(b: HouseholdBackup, mode: "replace" | "merge"): Promise<ImportReport>;

  getMeta<K extends keyof MetaShape>(key: K): Promise<MetaShape[K] | null>;
  setMeta<K extends keyof MetaShape>(key: K, value: MetaShape[K]): Promise<void>;
}
