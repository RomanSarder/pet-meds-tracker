// The IndexedDB `Repo` implementation (SPEC §8). Behavioural parity with
// `memoryRepo.ts` is non-negotiable wherever the brief is silent — read that
// file's comments before changing anything here that looks like a deviation.
import type { IDBPDatabase } from "idb";
import type {
  Course,
  CourseStatus,
  DoseEvent,
  DoseEventStatus,
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
  localDayKey,
  newId,
  now,
  occurrenceKeyFor,
  RETRACT_GRACE_MS,
  TINT_COUNT,
  UNDO_WINDOW_MS,
} from "@/domain";
import { RetractWindowExpiredError } from "./errors";
import { DB_NAME, openPetMedsDb, type PetMedsDB, type StoredMedication } from "./db";
import type { Repo } from "./repo.types";

function notFound(label: string, id: string): never {
  throw new Error(`${label} not found: ${id}`);
}

/** Narrows an optional row to a live one, or throws — mirrors memoryRepo's `requireAlive`. */
function assertAlive<T extends { deletedAt: string | null }>(
  row: T | undefined,
  label: string,
  id: string,
): T {
  if (!row || row.deletedAt !== null) notFound(label, id);
  return row;
}

/** Strips the internal `nameLower` column. The one place every read path funnels through. */
function toMedication(stored: StoredMedication): Medication {
  const {
    id,
    name,
    strength,
    form,
    unit,
    packSize,
    stockUnits,
    lowThreshold,
    createdAt,
    updatedAt,
    deletedAt,
  } = stored;
  return { id, name, strength, form, unit, packSize, stockUnits, lowThreshold, createdAt, updatedAt, deletedAt };
}

function toStoredMedication(m: Medication): StoredMedication {
  return { ...m, nameLower: m.name.trim().toLowerCase() };
}

/** Last-write-wins merge of one incoming array into one store, by `updatedAt`. */
async function mergeRows<T extends Timestamped & { id: string }>(
  incoming: T[],
  get: (id: string) => Promise<T | undefined>,
  put: (row: T) => Promise<unknown>,
): Promise<{ written: number; skipped: number }> {
  let written = 0;
  let skipped = 0;
  for (const row of incoming) {
    const existing = await get(row.id);
    if (!existing || row.updatedAt > existing.updatedAt) {
      await put(row);
      written += 1;
    } else {
      skipped += 1;
    }
  }
  return { written, skipped };
}

export function createIdbRepo(opts?: { dbName?: string }): Repo {
  let dbPromise: Promise<IDBPDatabase<PetMedsDB>> | null = null;
  const db = (): Promise<IDBPDatabase<PetMedsDB>> =>
    (dbPromise ??= openPetMedsDb(opts?.dbName ?? DB_NAME));

  // --- pets ---------------------------------------------------------------

  async function listPets(opts?: { includeArchived?: boolean }): Promise<Pet[]> {
    const includeArchived = opts?.includeArchived ?? false;
    const all = await (await db()).getAll("pets");
    return all.filter((p) => p.deletedAt === null && (includeArchived || !p.archived));
  }

  async function getPet(id: string): Promise<Pet | null> {
    const p = await (await db()).get("pets", id);
    return p && p.deletedAt === null ? p : null;
  }

  async function createPet(input: {
    name: string;
    species: Species;
    birthdate?: string | null;
    weightGrams?: number | null;
  }): Promise<Pet> {
    const conn = await db();
    const tx = conn.transaction(["pets", "meta"], "readwrite");
    const metaStore = tx.objectStore("meta");
    const petsStore = tx.objectStore("pets");

    const cursorRec = await metaStore.get("tintCursor");
    const cursor = (cursorRec?.value as number | undefined) ?? 0;
    const tint = ((cursor % TINT_COUNT) + 1) as Pet["tint"];
    await metaStore.put({ key: "tintCursor", value: cursor + 1 });

    const ts = now().toISOString();
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
    await petsStore.add(pet);
    await tx.done;
    return pet;
  }

  async function updatePet(
    id: string,
    patch: Partial<Pick<Pet, "name" | "species" | "birthdate" | "weightGrams">>,
  ): Promise<Pet> {
    const conn = await db();
    const tx = conn.transaction(["pets"], "readwrite");
    const store = tx.objectStore("pets");
    const existing = assertAlive(await store.get(id), "Pet", id);
    const updated: Pet = { ...existing, ...patch, updatedAt: now().toISOString() };
    await store.put(updated);
    await tx.done;
    return updated;
  }

  async function setPetArchived(id: string, archived: boolean): Promise<Pet> {
    const conn = await db();
    const tx = conn.transaction(["pets"], "readwrite");
    const store = tx.objectStore("pets");
    const existing = assertAlive(await store.get(id), "Pet", id);
    const updated: Pet = { ...existing, archived, updatedAt: now().toISOString() };
    await store.put(updated);
    await tx.done;
    return updated;
  }

  async function softDeletePet(id: string): Promise<void> {
    const conn = await db();
    const tx = conn.transaction(["pets"], "readwrite");
    const store = tx.objectStore("pets");
    const existing = assertAlive(await store.get(id), "Pet", id);
    const ts = now().toISOString();
    await store.put({ ...existing, deletedAt: ts, updatedAt: ts });
    await tx.done;
  }

  // --- medications ----------------------------------------------------

  async function listMedications(): Promise<Medication[]> {
    const all = await (await db()).getAll("medications");
    return all.filter((m) => m.deletedAt === null).map(toMedication);
  }

  async function getMedication(id: string): Promise<Medication | null> {
    const m = await (await db()).get("medications", id);
    return m && m.deletedAt === null ? toMedication(m) : null;
  }

  async function findMedicationByName(name: string): Promise<Medication | null> {
    const needle = name.trim().toLowerCase();
    const matches = await (await db()).getAllFromIndex("medications", "by_nameLower", needle);
    const alive = matches.find((m) => m.deletedAt === null);
    return alive ? toMedication(alive) : null;
  }

  async function createMedication(input: {
    name: string;
    form: MedicationForm;
    unit: string;
    strength?: string | null;
    packSize?: number | null;
    lowThreshold?: number | null;
  }): Promise<Medication> {
    const conn = await db();
    const ts = now().toISOString();
    const medication: StoredMedication = {
      id: newId(),
      name: input.name,
      nameLower: input.name.trim().toLowerCase(),
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
    await conn.add("medications", medication);
    return toMedication(medication);
  }

  async function updateMedication(
    id: string,
    patch: Partial<Omit<Medication, "id" | "stockUnits" | keyof Timestamped>>,
  ): Promise<Medication> {
    const conn = await db();
    const tx = conn.transaction(["medications"], "readwrite");
    const store = tx.objectStore("medications");
    const existing = assertAlive(await store.get(id), "Medication", id);
    // `stockUnits` is a derived cache only `adjustStock`/`setStockOnHand` may
    // write, and `nameLower` is derived from `name` — guard both at runtime
    // since the patch type omits `stockUnits` but callers can still smuggle
    // it through an untyped boundary.
    const merged: StoredMedication = {
      ...existing,
      ...patch,
      stockUnits: existing.stockUnits,
      updatedAt: now().toISOString(),
    };
    merged.nameLower = merged.name.trim().toLowerCase();
    await store.put(merged);
    await tx.done;
    return toMedication(merged);
  }

  // --- courses ----------------------------------------------------------
  // Courses are small per household (SPEC's own guidance): filter in memory
  // rather than lean on `by_petId`/`by_medicationId`/`by_status`, which exist
  // in the schema but are not queried here.

  async function listCourses(filter?: {
    petId?: string;
    medicationId?: string;
    status?: CourseStatus[];
  }): Promise<Course[]> {
    const all = await (await db()).getAll("courses");
    let result = all.filter((c) => c.deletedAt === null);
    if (filter?.petId) result = result.filter((c) => c.petId === filter.petId);
    if (filter?.medicationId) result = result.filter((c) => c.medicationId === filter.medicationId);
    if (filter?.status) result = result.filter((c) => filter.status!.includes(c.status));
    return result;
  }

  async function getCourse(id: string): Promise<Course | null> {
    const c = await (await db()).get("courses", id);
    return c && c.deletedAt === null ? c : null;
  }

  async function createCourse(
    input: Omit<Course, "id" | "status" | "resumedAt" | keyof Timestamped> & {
      status?: CourseStatus;
    },
  ): Promise<Course> {
    const conn = await db();
    const ts = now().toISOString();
    const { status, ...rest } = input;
    const course: Course = {
      ...rest,
      id: newId(),
      status: status ?? "active",
      resumedAt: null,
      createdAt: ts,
      updatedAt: ts,
      deletedAt: null,
    };
    await conn.add("courses", course);
    return course;
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
    const conn = await db();
    const tx = conn.transaction(["courses"], "readwrite");
    const store = tx.objectStore("courses");
    const existing = assertAlive(await store.get(id), "Course", id);
    const updated: Course = { ...existing, ...patch, updatedAt: now().toISOString() };
    await store.put(updated);
    await tx.done;
    return updated;
  }

  async function setCourseStatus(id: string, status: CourseStatus): Promise<Course> {
    const conn = await db();
    const tx = conn.transaction(["courses"], "readwrite");
    const store = tx.objectStore("courses");
    const existing = assertAlive(await store.get(id), "Course", id);
    const nowDate = now();
    const ts = nowDate.toISOString();
    // SPEC §3c: a paused -> active transition restarts a fromLastDose chain
    // from this moment; `stopped` records the day it was discontinued.
    const updated: Course = {
      ...existing,
      status,
      resumedAt: existing.status === "paused" && status === "active" ? ts : existing.resumedAt,
      endDate: status === "stopped" ? localDayKey(nowDate) : existing.endDate,
      updatedAt: ts,
    };
    await store.put(updated);
    await tx.done;
    return updated;
  }

  // --- dose events (append-only) -----------------------------------------
  // `listDoseEvents` narrows via the `by_courseId` index (`by_givenAt` and
  // `by_courseId_givenAt` exist per schema but are not queried anywhere yet —
  // filtering/ordering is on `loggedAt`, memoryRepo's rule), then re-applies
  // every filter in memory so behaviour matches memoryRepo exactly.

  async function listDoseEvents(filter: {
    courseId?: string;
    courseIds?: string[];
    from?: IsoDateTime;
    to?: IsoDateTime;
    limit?: number;
    newestFirst?: boolean;
  }): Promise<DoseEvent[]> {
    const conn = await db();
    let result: DoseEvent[];
    if (filter.courseId) {
      result = await conn.getAllFromIndex("doseEvents", "by_courseId", filter.courseId);
    } else if (filter.courseIds) {
      const lists = await Promise.all(
        filter.courseIds.map((cid) => conn.getAllFromIndex("doseEvents", "by_courseId", cid)),
      );
      result = lists.flat();
    } else {
      result = await conn.getAll("doseEvents");
    }
    result = result.filter((e) => e.deletedAt === null);
    if (filter.courseId) result = result.filter((e) => e.courseId === filter.courseId);
    if (filter.courseIds) result = result.filter((e) => filter.courseIds!.includes(e.courseId));
    if (filter.from) result = result.filter((e) => e.loggedAt >= filter.from!);
    if (filter.to) result = result.filter((e) => e.loggedAt <= filter.to!);
    result = [...result].sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
    if (filter.newestFirst) result.reverse();
    if (filter.limit !== undefined) result = result.slice(0, filter.limit);
    return result;
  }

  async function logDose(input: {
    courseId: string;
    status: "given" | "skipped";
    scheduledFor: IsoDateTime | null;
    givenAt?: IsoDateTime;
    amount: number;
    note?: string;
  }): Promise<DoseEvent> {
    const conn = await db();
    const tx = conn.transaction(["doseEvents"], "readwrite");
    const store = tx.objectStore("doseEvents");
    const ts = now().toISOString();
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
    await store.add(event);
    await tx.done;
    return event;
  }

  async function correctDose(
    originalId: string,
    patch: { givenAt?: IsoDateTime; amount?: number; status?: DoseEventStatus; note?: string },
  ): Promise<DoseEvent> {
    const conn = await db();
    const tx = conn.transaction(["doseEvents"], "readwrite");
    const store = tx.objectStore("doseEvents");
    const original = await store.get(originalId);
    if (!original) notFound("DoseEvent", originalId);
    const ts = now().toISOString();
    const corrected: DoseEvent = {
      ...original,
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
    await store.add(corrected);
    await tx.done;
    return corrected;
  }

  async function retractDoseEvent(id: string): Promise<void> {
    const conn = await db();
    const tx = conn.transaction(["doseEvents"], "readwrite");
    const store = tx.objectStore("doseEvents");
    const event = await store.get(id);
    if (!event) notFound("DoseEvent", id);

    const elapsed = now().getTime() - new Date(event.loggedAt).getTime();
    if (elapsed > UNDO_WINDOW_MS + RETRACT_GRACE_MS) {
      throw new RetractWindowExpiredError(id);
    }
    // `supersedesId` can't be indexed (nullable), so find the superseder by
    // scanning `by_courseId` for this row's courseId — corrections always
    // inherit courseId from the row they correct.
    const siblings = await store.index("by_courseId").getAll(event.courseId);
    const hasSuperseder = siblings.some((e) => e.supersedesId === id);
    if (hasSuperseder) {
      throw new Error(`Dose event ${id} has already been corrected and cannot be retracted`);
    }
    // The sole exception to append-only (SPEC §7 item 1): a bounded hard
    // delete, not a soft delete and not a compensating row.
    await store.delete(id);
    await tx.done;
  }

  async function recordMissed(
    inputs: Array<{ courseId: string; scheduledFor: IsoDateTime; amount: number }>,
  ): Promise<DoseEvent[]> {
    const conn = await db();
    const tx = conn.transaction(["doseEvents"], "readwrite");
    const store = tx.objectStore("doseEvents");
    const created: DoseEvent[] = [];
    for (const input of inputs) {
      const occurrenceKey = occurrenceKeyFor(input.courseId, input.scheduledFor);
      // occurrenceKey makes this idempotent: a sweep that runs twice over the
      // same occurrence must not double-write it.
      const existing = await store.index("by_occurrenceKey").getAll(occurrenceKey);
      const already = existing.some((e) => e.deletedAt === null);
      if (already) continue;
      const ts = now().toISOString();
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
      await store.add(event);
      created.push(event);
    }
    await tx.done;
    return created;
  }

  // --- stock (append-only ledger; stockUnits is a derived cache) --------
  // The only two methods allowed to name `medications` alongside `stockAdjustments`.

  async function listStockAdjustments(medicationId?: string): Promise<StockAdjustment[]> {
    const conn = await db();
    const result = medicationId
      ? await conn.getAllFromIndex("stockAdjustments", "by_medicationId", medicationId)
      : await conn.getAll("stockAdjustments");
    return result.filter((a) => a.deletedAt === null);
  }

  async function adjustStock(input: {
    medicationId: string;
    deltaUnits: number;
    reason: StockReason;
    note?: string;
  }): Promise<StockAdjustment> {
    const conn = await db();
    const tx = conn.transaction(["stockAdjustments", "medications"], "readwrite");
    const stockStore = tx.objectStore("stockAdjustments");
    const medStore = tx.objectStore("medications");

    const ts = now().toISOString();
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
    await stockStore.add(adjustment);

    const ledger = await stockStore.index("by_medicationId").getAll(input.medicationId);
    const total = ledger.filter((a) => a.deletedAt === null).reduce((sum, a) => sum + a.deltaUnits, 0);
    const medication = await medStore.get(input.medicationId);
    if (medication) {
      await medStore.put({ ...medication, stockUnits: total, updatedAt: ts });
    }
    await tx.done;
    return adjustment;
  }

  async function setStockOnHand(
    medicationId: string,
    units: number,
    note?: string,
  ): Promise<StockAdjustment> {
    const conn = await db();
    const tx = conn.transaction(["stockAdjustments", "medications"], "readwrite");
    const stockStore = tx.objectStore("stockAdjustments");
    const medStore = tx.objectStore("medications");

    const ledger = await stockStore.index("by_medicationId").getAll(medicationId);
    const currentTotal = ledger.filter((a) => a.deletedAt === null).reduce((sum, a) => sum + a.deltaUnits, 0);

    const ts = now().toISOString();
    const adjustment: StockAdjustment = {
      id: newId(),
      medicationId,
      deltaUnits: units - currentTotal,
      reason: "correction",
      note: note ?? null,
      createdAt: ts,
      updatedAt: ts,
      deletedAt: null,
    };
    await stockStore.add(adjustment);

    const medication = await medStore.get(medicationId);
    if (medication) {
      await medStore.put({ ...medication, stockUnits: units, updatedAt: ts });
    }
    await tx.done;
    return adjustment;
  }

  // --- backup / restore ---------------------------------------------------

  async function exportHousehold(): Promise<HouseholdBackup> {
    const conn = await db();
    const tx = conn.transaction(
      ["pets", "medications", "courses", "doseEvents", "stockAdjustments", "meta"],
      "readonly",
    );
    const [pets, meds, courses, doseEvents, stockAdjustments, schemaVersionRec, tintCursorRec, lastSweepDayRec] =
      await Promise.all([
        tx.objectStore("pets").getAll(),
        tx.objectStore("medications").getAll(),
        tx.objectStore("courses").getAll(),
        tx.objectStore("doseEvents").getAll(),
        tx.objectStore("stockAdjustments").getAll(),
        tx.objectStore("meta").get("schemaVersion"),
        tx.objectStore("meta").get("tintCursor"),
        tx.objectStore("meta").get("lastSweepDay"),
      ]);
    await tx.done;
    // Includes soft-deleted rows in every array — a backup that drops
    // tombstones cannot later sync (SPEC §8).
    return {
      schemaVersion: (schemaVersionRec?.value as number | undefined) ?? 1,
      exportedAt: now().toISOString(),
      pets,
      medications: meds.map(toMedication),
      courses,
      doseEvents,
      stockAdjustments,
      meta: {
        tintCursor: (tintCursorRec?.value as number | undefined) ?? 0,
        lastSweepDay: (lastSweepDayRec?.value as MetaShape["lastSweepDay"] | undefined) ?? null,
      },
    };
  }

  async function importHousehold(b: HouseholdBackup, mode: "replace" | "merge"): Promise<ImportReport> {
    const conn = await db();
    const tx = conn.transaction(
      ["pets", "medications", "courses", "doseEvents", "stockAdjustments", "meta"],
      "readwrite",
    );
    const petsStore = tx.objectStore("pets");
    const medsStore = tx.objectStore("medications");
    const coursesStore = tx.objectStore("courses");
    const eventsStore = tx.objectStore("doseEvents");
    const stockStore = tx.objectStore("stockAdjustments");
    const metaStore = tx.objectStore("meta");

    if (mode === "replace") {
      await Promise.all([
        petsStore.clear(),
        medsStore.clear(),
        coursesStore.clear(),
        eventsStore.clear(),
        stockStore.clear(),
      ]);
      for (const p of b.pets) await petsStore.put(p);
      for (const m of b.medications) await medsStore.put(toStoredMedication(m));
      for (const c of b.courses) await coursesStore.put(c);
      for (const e of b.doseEvents) await eventsStore.put(e);
      for (const a of b.stockAdjustments) await stockStore.put(a);

      // Transport the real cursor/sweep-day when the backup carries them
      // (a v1 backup written after this fix); fall back to the old,
      // re-derived behaviour for backups written before `meta` existed.
      await metaStore.put({ key: "tintCursor", value: b.meta?.tintCursor ?? b.pets.length });
      await metaStore.put({ key: "schemaVersion", value: b.schemaVersion });
      await metaStore.put({ key: "lastSweepDay", value: b.meta?.lastSweepDay ?? null });
      await tx.done;

      return {
        mode,
        pets: b.pets.length,
        medications: b.medications.length,
        courses: b.courses.length,
        doseEvents: b.doseEvents.length,
        stockAdjustments: b.stockAdjustments.length,
        skipped: 0,
      };
    }

    const petsR = await mergeRows(
      b.pets,
      (id) => petsStore.get(id),
      (row) => petsStore.put(row),
    );
    const medsR = await mergeRows(
      b.medications.map(toStoredMedication),
      (id) => medsStore.get(id),
      (row) => medsStore.put(row),
    );
    const coursesR = await mergeRows(
      b.courses,
      (id) => coursesStore.get(id),
      (row) => coursesStore.put(row),
    );
    const eventsR = await mergeRows(
      b.doseEvents,
      (id) => eventsStore.get(id),
      (row) => eventsStore.put(row),
    );
    const stockR = await mergeRows(
      b.stockAdjustments,
      (id) => stockStore.get(id),
      (row) => stockStore.put(row),
    );

    // Merge only ever moves the cursor forward, and only when the incoming
    // backup actually carries one — an old backup without `meta` must not
    // reset or otherwise perturb the current cursor.
    if (b.meta) {
      const cursorRec = await metaStore.get("tintCursor");
      const currentCursor = (cursorRec?.value as number | undefined) ?? 0;
      await metaStore.put({ key: "tintCursor", value: Math.max(currentCursor, b.meta.tintCursor) });
    }

    await tx.done;

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
    const rec = await (await db()).get("meta", key);
    return (rec?.value as MetaShape[K] | undefined) ?? null;
  }

  async function setMeta<K extends keyof MetaShape>(key: K, value: MetaShape[K]): Promise<void> {
    await (await db()).put("meta", { key, value });
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
