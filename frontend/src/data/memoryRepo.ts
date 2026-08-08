// A complete, honest in-memory implementation of `Repo`. This is what the UI
// workers develop and test against; W1 (slice 2) later ships `createIdbRepo`
// against the same interface. Every invariant enforced here (append-only
// dose history, cached stockUnits, monotonic tint cursor, bounded-window
// retraction) is the same invariant the IndexedDB repo must enforce, so
// nothing here is "just for tests".
import type {
  Course,
  CourseStatus,
  DoseEvent,
  DoseEventStatus,
  FixtureData,
  HouseholdBackup,
  ImportReport,
  IsoDateTime,
  Medication,
  MedicationForm,
  MetaShape,
  Pet,
  Species,
  StockAdjustment,
  StockReason,
  Timestamped,
} from "@/domain";
import {
  cloneFixtures,
  localDayKey,
  newId,
  now,
  occurrenceKeyFor,
  TINT_COUNT,
  UNDO_WINDOW_MS,
  RETRACT_GRACE_MS,
} from "@/domain";
import type { Repo } from "./repo.types";
import { RetractWindowExpiredError } from "./errors";

export { RetractWindowExpiredError } from "./errors";

function stamp(): IsoDateTime {
  return now().toISOString();
}

function notFound(label: string, id: string): never {
  throw new Error(`${label} not found: ${id}`);
}

export function createMemoryRepo(seed?: FixtureData): Repo {
  // `structuredClone` on the caller's seed (or `cloneFixtures()` for the
  // default fixture constant) so the shared source can never be mutated by
  // this store, and so the store can never be mutated by anyone holding a
  // reference to the object they passed in.
  const source: FixtureData = seed ? structuredClone(seed) : cloneFixtures();

  let pets: Pet[] = source.pets;
  let medications: Medication[] = source.medications;
  let courses: Course[] = source.courses;
  let doseEvents: DoseEvent[] = source.doseEvents;
  let stockAdjustments: StockAdjustment[] = source.stockAdjustments;

  // Cursor starts consistent with however many pets were seeded, assuming
  // (as our own fixtures do) that they were assigned tints 1..N in creation
  // order starting from cursor 0. A caller seeding out-of-band data with a
  // different tint layout gets a cursor that is merely a reasonable guess,
  // documented here rather than silently "fixed".
  const meta: MetaShape = {
    schemaVersion: 1,
    tintCursor: pets.length,
    lastSweepDay: null,
  };

  // --- small internal helpers ------------------------------------------

  function findAlive<T extends Timestamped>(arr: T[], id: string): T | undefined {
    return arr.find((r) => (r as unknown as { id: string }).id === id && r.deletedAt === null);
  }

  function requireAlive<T extends Timestamped & { id: string }>(arr: T[], id: string, label: string): T {
    const row = arr.find((r) => r.id === id && r.deletedAt === null);
    if (!row) notFound(label, id);
    return row;
  }

  // --- pets ---------------------------------------------------------------

  async function listPets(opts?: { includeArchived?: boolean }): Promise<Pet[]> {
    const includeArchived = opts?.includeArchived ?? false;
    return structuredClone(
      pets.filter((p) => p.deletedAt === null && (includeArchived || !p.archived)),
    );
  }

  async function getPet(id: string): Promise<Pet | null> {
    const p = findAlive(pets, id);
    return p ? structuredClone(p) : null;
  }

  async function createPet(input: {
    name: string;
    species: Species;
    birthdate?: string | null;
    weightGrams?: number | null;
  }): Promise<Pet> {
    const tint = ((meta.tintCursor % TINT_COUNT) + 1) as Pet["tint"];
    meta.tintCursor += 1;
    const ts = stamp();
    const pet: Pet = {
      id: newId(),
      name: input.name,
      species: input.species,
      birthdate: input.birthdate ?? null,
      weightGrams: input.weightGrams ?? null,
      tint,
      archived: false,
      createdAt: ts,
      updatedAt: ts,
      deletedAt: null,
    };
    pets.push(pet);
    return structuredClone(pet);
  }

  async function updatePet(
    id: string,
    patch: Partial<Pick<Pet, "name" | "species" | "birthdate" | "weightGrams">>,
  ): Promise<Pet> {
    const pet = requireAlive(pets, id, "Pet");
    Object.assign(pet, patch, { updatedAt: stamp() });
    return structuredClone(pet);
  }

  async function setPetArchived(id: string, archived: boolean): Promise<Pet> {
    const pet = requireAlive(pets, id, "Pet");
    pet.archived = archived;
    pet.updatedAt = stamp();
    return structuredClone(pet);
  }

  async function softDeletePet(id: string): Promise<void> {
    const pet = requireAlive(pets, id, "Pet");
    const ts = stamp();
    pet.deletedAt = ts;
    pet.updatedAt = ts;
  }

  // --- medications ----------------------------------------------------

  async function listMedications(): Promise<Medication[]> {
    return structuredClone(medications.filter((m) => m.deletedAt === null));
  }

  async function getMedication(id: string): Promise<Medication | null> {
    const m = findAlive(medications, id);
    return m ? structuredClone(m) : null;
  }

  async function findMedicationByName(name: string): Promise<Medication | null> {
    const needle = name.trim().toLowerCase();
    const m = medications.find(
      (med) => med.deletedAt === null && med.name.trim().toLowerCase() === needle,
    );
    return m ? structuredClone(m) : null;
  }

  async function createMedication(input: {
    name: string;
    form: MedicationForm;
    unit: string;
    strength?: string | null;
    packSize?: number | null;
    lowThreshold?: number | null;
  }): Promise<Medication> {
    const ts = stamp();
    const medication: Medication = {
      id: newId(),
      name: input.name,
      strength: input.strength ?? null,
      form: input.form,
      unit: input.unit,
      packSize: input.packSize ?? null,
      stockUnits: null,
      lowThreshold: input.lowThreshold ?? null,
      createdAt: ts,
      updatedAt: ts,
      deletedAt: null,
    };
    medications.push(medication);
    return structuredClone(medication);
  }

  async function updateMedication(
    id: string,
    patch: Partial<Omit<Medication, "id" | "stockUnits" | keyof Timestamped>>,
  ): Promise<Medication> {
    const medication = requireAlive(medications, id, "Medication");
    // `stockUnits` is a derived cache only `adjustStock`/`setStockOnHand` may
    // write; guard at runtime since the patch type omits it but callers can
    // still smuggle it through an untyped boundary.
    Object.assign(medication, patch, { stockUnits: medication.stockUnits, updatedAt: stamp() });
    return structuredClone(medication);
  }

  // --- courses ----------------------------------------------------------

  async function listCourses(filter?: {
    petId?: string;
    medicationId?: string;
    status?: CourseStatus[];
  }): Promise<Course[]> {
    let result = courses.filter((c) => c.deletedAt === null);
    if (filter?.petId) result = result.filter((c) => c.petId === filter.petId);
    if (filter?.medicationId) result = result.filter((c) => c.medicationId === filter.medicationId);
    if (filter?.status) result = result.filter((c) => filter.status!.includes(c.status));
    return structuredClone(result);
  }

  async function getCourse(id: string): Promise<Course | null> {
    const c = findAlive(courses, id);
    return c ? structuredClone(c) : null;
  }

  async function createCourse(
    input: Omit<Course, "id" | "status" | "resumedAt" | keyof Timestamped> & {
      status?: CourseStatus;
    },
  ): Promise<Course> {
    const ts = stamp();
    const { status, ...rest } = input;
    const course: Course = {
      ...structuredClone(rest),
      id: newId(),
      status: status ?? "active",
      resumedAt: null,
      createdAt: ts,
      updatedAt: ts,
      deletedAt: null,
    };
    courses.push(course);
    return structuredClone(course);
  }

  async function updateCourse(
    id: string,
    patch: Partial<
      Pick<
        Course,
        "doseAmount" | "doseUnit" | "instructions" | "schedule" | "startDate" | "endDate" | "notes"
      >
    >,
  ): Promise<Course> {
    const course = requireAlive(courses, id, "Course");
    Object.assign(course, structuredClone(patch), { updatedAt: stamp() });
    return structuredClone(course);
  }

  async function setCourseStatus(id: string, status: CourseStatus): Promise<Course> {
    const course = requireAlive(courses, id, "Course");
    // SPEC §3c: resuming a `fromLastDose` course restarts the chain from the
    // resume moment. `Course.resumedAt` exists solely to record that moment;
    // this is the only place a status transition happens, so this is the
    // only place that can set it. Only a paused -> active transition counts
    // as "resuming".
    if (course.status === "paused" && status === "active") {
      course.resumedAt = stamp();
    }
    // SPEC §3c: `stopped` is a user action (medication discontinued); it sets
    // endDate = today, the local day key of `now()`.
    if (status === "stopped") {
      course.endDate = localDayKey(now());
    }
    course.status = status;
    course.updatedAt = stamp();
    return structuredClone(course);
  }

  // --- dose events (append-only) -----------------------------------------

  async function listDoseEvents(filter: {
    courseId?: string;
    courseIds?: string[];
    from?: IsoDateTime;
    to?: IsoDateTime;
    limit?: number;
    newestFirst?: boolean;
  }): Promise<DoseEvent[]> {
    let result = doseEvents.filter((e) => e.deletedAt === null);
    if (filter.courseId) result = result.filter((e) => e.courseId === filter.courseId);
    if (filter.courseIds) result = result.filter((e) => filter.courseIds!.includes(e.courseId));
    // `loggedAt` is the one timestamp every DoseEvent always has (scheduledFor
    // is null for fromLastDose events before their first log), so range
    // filtering and ordering both key off it.
    if (filter.from) result = result.filter((e) => e.loggedAt >= filter.from!);
    if (filter.to) result = result.filter((e) => e.loggedAt <= filter.to!);
    result = [...result].sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
    if (filter.newestFirst) result.reverse();
    if (filter.limit !== undefined) result = result.slice(0, filter.limit);
    return structuredClone(result);
  }

  async function logDose(input: {
    courseId: string;
    status: "given" | "skipped";
    scheduledFor: IsoDateTime | null;
    givenAt?: IsoDateTime;
    amount: number;
    note?: string;
  }): Promise<DoseEvent> {
    const ts = stamp();
    const event: DoseEvent = {
      id: newId(),
      courseId: input.courseId,
      scheduledFor: input.scheduledFor,
      status: input.status,
      loggedAt: ts,
      givenAt: input.givenAt ?? ts,
      amount: input.amount,
      note: input.note ?? null,
      occurrenceKey: occurrenceKeyFor(input.courseId, input.scheduledFor),
      supersedesId: null,
      createdAt: ts,
      updatedAt: ts,
      deletedAt: null,
    };
    doseEvents.push(event);
    return structuredClone(event);
  }

  async function correctDose(
    originalId: string,
    patch: { givenAt?: IsoDateTime; amount?: number; status?: DoseEventStatus; note?: string },
  ): Promise<DoseEvent> {
    const original = doseEvents.find((e) => e.id === originalId);
    if (!original) notFound("DoseEvent", originalId);
    const ts = stamp();
    const corrected: DoseEvent = {
      ...structuredClone(original),
      id: newId(),
      status: patch.status ?? original.status,
      givenAt: patch.givenAt ?? original.givenAt,
      amount: patch.amount ?? original.amount,
      note: patch.note ?? original.note,
      loggedAt: ts,
      supersedesId: originalId,
      createdAt: ts,
      updatedAt: ts,
      deletedAt: null,
    };
    // The original row is never touched — append-only.
    doseEvents.push(corrected);
    return structuredClone(corrected);
  }

  async function retractDoseEvent(id: string): Promise<void> {
    const idx = doseEvents.findIndex((e) => e.id === id);
    if (idx === -1) notFound("DoseEvent", id);
    const event = doseEvents[idx];

    const elapsed = now().getTime() - new Date(event.loggedAt).getTime();
    if (elapsed > UNDO_WINDOW_MS + RETRACT_GRACE_MS) {
      throw new RetractWindowExpiredError(id);
    }
    const hasSuperseder = doseEvents.some((e) => e.supersedesId === id);
    if (hasSuperseder) {
      throw new Error(`Dose event ${id} has already been corrected and cannot be retracted`);
    }
    // The sole exception to append-only (brief §7 item 1): a bounded hard
    // delete, not a soft delete and not a compensating row.
    doseEvents.splice(idx, 1);
  }

  async function recordMissed(
    inputs: Array<{ courseId: string; scheduledFor: IsoDateTime; amount: number }>,
  ): Promise<DoseEvent[]> {
    const created: DoseEvent[] = [];
    for (const input of inputs) {
      const occurrenceKey = occurrenceKeyFor(input.courseId, input.scheduledFor);
      // occurrenceKey makes this idempotent: a sweep that runs twice over
      // the same occurrence must not double-write it.
      const already = doseEvents.some((e) => e.deletedAt === null && e.occurrenceKey === occurrenceKey);
      if (already) continue;
      const ts = stamp();
      const event: DoseEvent = {
        id: newId(),
        courseId: input.courseId,
        scheduledFor: input.scheduledFor,
        status: "missed",
        loggedAt: ts,
        givenAt: ts,
        amount: input.amount,
        note: null,
        occurrenceKey,
        supersedesId: null,
        createdAt: ts,
        updatedAt: ts,
        deletedAt: null,
      };
      doseEvents.push(event);
      created.push(event);
    }
    return structuredClone(created);
  }

  // --- stock (append-only ledger; stockUnits is a derived cache) --------

  function recomputeStockUnits(medicationId: string): void {
    const total = stockAdjustments
      .filter((a) => a.deletedAt === null && a.medicationId === medicationId)
      .reduce((sum, a) => sum + a.deltaUnits, 0);
    const medication = medications.find((m) => m.id === medicationId);
    if (medication) medication.stockUnits = total;
  }

  async function listStockAdjustments(medicationId?: string): Promise<StockAdjustment[]> {
    let result = stockAdjustments.filter((a) => a.deletedAt === null);
    if (medicationId) result = result.filter((a) => a.medicationId === medicationId);
    return structuredClone(result);
  }

  async function adjustStock(input: {
    medicationId: string;
    deltaUnits: number;
    reason: StockReason;
    note?: string;
  }): Promise<StockAdjustment> {
    const ts = stamp();
    const adjustment: StockAdjustment = {
      id: newId(),
      medicationId: input.medicationId,
      deltaUnits: input.deltaUnits,
      reason: input.reason,
      note: input.note ?? null,
      createdAt: ts,
      updatedAt: ts,
      deletedAt: null,
    };
    stockAdjustments.push(adjustment);
    recomputeStockUnits(input.medicationId);
    return structuredClone(adjustment);
  }

  async function setStockOnHand(medicationId: string, units: number, note?: string): Promise<StockAdjustment> {
    const currentTotal = stockAdjustments
      .filter((a) => a.deletedAt === null && a.medicationId === medicationId)
      .reduce((sum, a) => sum + a.deltaUnits, 0);
    return adjustStock({
      medicationId,
      deltaUnits: units - currentTotal,
      reason: "correction",
      note,
    });
  }

  // --- backup / restore ---------------------------------------------------

  async function exportHousehold(): Promise<HouseholdBackup> {
    return structuredClone({
      schemaVersion: meta.schemaVersion,
      exportedAt: stamp(),
      pets,
      medications,
      courses,
      doseEvents,
      stockAdjustments,
      meta: { tintCursor: meta.tintCursor, lastSweepDay: meta.lastSweepDay },
    });
  }

  function mergeArray<T extends Timestamped & { id: string }>(
    current: T[],
    incoming: T[],
  ): { merged: T[]; written: number; skipped: number } {
    const byId = new Map(current.map((r) => [r.id, r]));
    let written = 0;
    let skipped = 0;
    for (const row of incoming) {
      const existing = byId.get(row.id);
      if (!existing || row.updatedAt > existing.updatedAt) {
        byId.set(row.id, structuredClone(row));
        written += 1;
      } else {
        skipped += 1;
      }
    }
    return { merged: Array.from(byId.values()), written, skipped };
  }

  async function importHousehold(b: HouseholdBackup, mode: "replace" | "merge"): Promise<ImportReport> {
    if (mode === "replace") {
      pets = structuredClone(b.pets);
      medications = structuredClone(b.medications);
      courses = structuredClone(b.courses);
      doseEvents = structuredClone(b.doseEvents);
      stockAdjustments = structuredClone(b.stockAdjustments);
      meta.schemaVersion = b.schemaVersion;
      // Transport the real cursor/sweep-day when the backup carries them
      // (a v1 backup written after this fix); fall back to the old,
      // re-derived behaviour for backups written before `meta` existed.
      meta.tintCursor = b.meta?.tintCursor ?? pets.length;
      meta.lastSweepDay = b.meta?.lastSweepDay ?? null;
      return {
        mode,
        pets: pets.length,
        medications: medications.length,
        courses: courses.length,
        doseEvents: doseEvents.length,
        stockAdjustments: stockAdjustments.length,
        skipped: 0,
      };
    }

    const petsR = mergeArray(pets, b.pets);
    const medsR = mergeArray(medications, b.medications);
    const coursesR = mergeArray(courses, b.courses);
    const eventsR = mergeArray(doseEvents, b.doseEvents);
    const stockR = mergeArray(stockAdjustments, b.stockAdjustments);

    pets = petsR.merged;
    medications = medsR.merged;
    courses = coursesR.merged;
    doseEvents = eventsR.merged;
    stockAdjustments = stockR.merged;

    // Merge only ever moves the cursor forward, and only when the incoming
    // backup actually carries one — an old backup without `meta` must not
    // reset or otherwise perturb the current cursor.
    if (b.meta) {
      meta.tintCursor = Math.max(meta.tintCursor, b.meta.tintCursor);
    }

    return {
      mode,
      pets: petsR.written,
      medications: medsR.written,
      courses: coursesR.written,
      doseEvents: eventsR.written,
      stockAdjustments: stockR.written,
      skipped: petsR.skipped + medsR.skipped + coursesR.skipped + eventsR.skipped + stockR.skipped,
    };
  }

  // --- meta -----------------------------------------------------------

  async function getMeta<K extends keyof MetaShape>(key: K): Promise<MetaShape[K] | null> {
    return meta[key] ?? null;
  }

  async function setMeta<K extends keyof MetaShape>(key: K, value: MetaShape[K]): Promise<void> {
    meta[key] = value;
  }

  return {
    listPets,
    getPet,
    createPet,
    updatePet,
    setPetArchived,
    softDeletePet,
    listMedications,
    getMedication,
    findMedicationByName,
    createMedication,
    updateMedication,
    listCourses,
    getCourse,
    createCourse,
    updateCourse,
    setCourseStatus,
    listDoseEvents,
    logDose,
    correctDose,
    retractDoseEvent,
    recordMissed,
    listStockAdjustments,
    adjustStock,
    setStockOnHand,
    exportHousehold,
    importHousehold,
    getMeta,
    setMeta,
  };
}
