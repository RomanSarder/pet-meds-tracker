// The `Repo` interface — the contract every UI-facing worker builds against.
// W1 (slice 2) implements `createIdbRepo()` against this same interface; this
// branch (W0) ships `createMemoryRepo()` as the interim (and permanent test)
// implementation. Signatures here are reproduced VERBATIM from the W0
// foundations brief §4 — do not "fix" anything here without raising it, since
// four other branches import this file.
import type {
  Course,
  CourseEvent,
  CourseStatus,
  DoseEvent,
  DoseEventStatus,
  Household,
  HouseholdBackup,
  ImportReport,
  IsoDateTime,
  JoinCode,
  LocalDate,
  Medication,
  MedicationForm,
  MetaShape,
  Pet,
  Species,
  StockAdjustment,
  StockReason,
  Timestamped,
  User,
} from "@/domain";

/**
 * W9 sync (design §D4): rows learned from another device or a merge-mode
 * import. Reuses `HouseholdBackup`'s shapes so slice 9 introduces no
 * parallel row types. Deliberately excludes `households`/`users` — those
 * keep merging the way `importHousehold` already did.
 */
export type RemoteChanges = Partial<
  Pick<
    HouseholdBackup,
    "pets" | "medications" | "courses" | "doseEvents" | "stockAdjustments" | "courseEvents"
  >
>;

export interface ApplyReport {
  applied: Record<keyof RemoteChanges, number>;
  /** Rows seen and deliberately not written: an older LWW loser, or a ledger id already held. */
  ignored: number;
}

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

  /**
   * SPEC §6.4's course lifecycle ledger. Append-only and READ-ONLY to callers:
   * rows are written only from inside `createCourse`, `setCourseStatus` and
   * `updateCourse`, which is why there is no `recordCourseEvent` here. A
   * feature never writes one.
   */
  listCourseEvents(filter: {
    courseId?: string;
    courseIds?: string[];
    from?: IsoDateTime;
    to?: IsoDateTime;
    limit?: number;
    newestFirst?: boolean;
  }): Promise<CourseEvent[]>;

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
    /**
     * User-confirmed early give (SPEC §3b: "logging a dose early ... is
     * intended"). Bypasses ONLY the grace-window collision heuristic — a
     * live event on this course logged within the schedule's grace window —
     * never the exact-same-occurrence check just above it in the dedup
     * guard, which stays a hard block regardless: re-logging the identical
     * `scheduledFor` is always a true duplicate, confirmed or not.
     */
    allowWithinGrace?: boolean;
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

  /**
   * Discards every local domain row and provisions a fresh, empty household with
   * NEW `householdId` and `selfUserId`, and a cleared sync watermark
   * (`syncCursor` and `lastPushedAt` back to null).
   *
   * The new ids are the point, not a side effect: reusing the previous account's
   * `householdId` is what made a second account on the same device collide on
   * `households_pkey` when sync provisioned it server-side.
   *
   * Callers MUST establish that the data is recoverable before calling this —
   * see `localStoreIsDisposable()`. Nothing in this method asks.
   */
  resetLocalHousehold(): Promise<void>;

  /**
   * W9 sync (design §D2/§D4/§D8): the single reconciliation rule for both
   * sync and merge-mode import. Mutable entities (`pets`, `medications`,
   * `courses`): last-write-wins on `updatedAt`, tie-break greater `id`.
   * Append-only ledgers (`doseEvents`, `stockAdjustments`, `courseEvents`):
   * insert-if-absent, never overwritten. Rows land with their incoming `id`,
   * `createdAt`, `updatedAt` and `actorId` intact — the one write path that
   * does not stamp `currentActorId()`. `importHousehold(b, "merge")` routes
   * through this and must not implement its own version of the rule.
   */
  applyRemoteChanges(changes: RemoteChanges): Promise<ApplyReport>;

  getMeta<K extends keyof MetaShape>(key: K): Promise<MetaShape[K] | null>;
  setMeta<K extends keyof MetaShape>(key: K, value: MetaShape[K]): Promise<void>;

  /**
   * SPEC §11: the current actor, stubbed to a single local user until slice 8 replaces the
   * source. Never null, never throws — a repo with no self user creates one on demand.
   */
  currentActorId(): Promise<string>;
  /** The local household id. Same non-null guarantee. */
  currentHouseholdId(): Promise<string>;

  getHousehold(id: string): Promise<Household | null>;
  getCurrentHousehold(): Promise<Household>;
  updateHousehold(id: string, patch: Partial<Pick<Household, "name">>): Promise<Household>;

  /** Members of the local household, soft-deleted ones excluded unless `includeRemoved`. */
  listUsers(opts?: { includeRemoved?: boolean }): Promise<User[]>;
  getUser(id: string): Promise<User | null>;
  getCurrentUser(): Promise<User>;
  /** Insert or replace a member row wholesale — how slice 8 lands members it learns from the server. */
  upsertUser(user: User): Promise<User>;
  updateUser(id: string, patch: Partial<Pick<User, "displayName" | "tint">>): Promise<User>;
  /** Soft-delete. History keeps the `actorId`; the name still resolves. Never hard-deletes. */
  removeUser(id: string): Promise<void>;

  listJoinCodes(): Promise<JoinCode[]>;
  getJoinCodeByCode(code: string): Promise<JoinCode | null>;
  /** Revokes any other live code for the household first — SPEC §5: one live code at a time. */
  createJoinCode(input: { code: string; expiresAt: IsoDateTime }): Promise<JoinCode>;
  markJoinCodeUsed(id: string, usedBy: string): Promise<JoinCode>;
  revokeJoinCode(id: string): Promise<JoinCode>;
}
