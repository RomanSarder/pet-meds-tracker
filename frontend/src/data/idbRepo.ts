// The IndexedDB `Repo` implementation (SPEC §8). Behavioural parity with
// `memoryRepo.ts` is non-negotiable wherever the brief is silent — read that
// file's comments before changing anything here that looks like a deviation.
import type { IDBPDatabase } from "idb";
import type {
  Course,
  CourseEvent,
  CourseEventKind,
  CourseSnapshot,
  CourseStatus,
  DoseEvent,
  DoseEventStatus,
  Household,
  HouseholdBackup,
  ImportReport,
  IsoDateTime,
  JoinCode,
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
import {
  DEFAULT_SELF_DISPLAY_NAME,
  GRACE_FIXED_MIN,
  GRACE_INTERVAL_MIN,
  localDayKey,
  newId,
  now,
  occurrenceKeyFor,
  RETRACT_GRACE_MS,
  TINT_COUNT,
  UNDO_WINDOW_MS,
} from "@/domain";
import { DuplicateDoseError, RetractWindowExpiredError } from "./errors";
import { DB_NAME, openPetMedsDb, type PetMedsDB, type StoredMedication } from "./db";
import type { ApplyReport, RemoteChanges, Repo } from "./repo.types";

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

/**
 * SPEC §6.4's ledger snapshot — only the fields a detail line can render.
 * Mirrors memoryRepo's `courseSnapshot` exactly.
 */
function courseSnapshot(course: Course): CourseSnapshot {
  return {
    schedule: structuredClone(course.schedule),
    doseAmount: course.doseAmount,
    doseUnit: course.doseUnit,
    startDate: course.startDate,
    endDate: course.endDate,
  };
}

/** Mirrors memoryRepo's `courseEventKindForStatusChange` exactly. */
function courseEventKindForStatusChange(status: CourseStatus): CourseEventKind {
  switch (status) {
    case "active":
      return "resumed";
    case "paused":
      return "paused";
    case "stopped":
      return "stopped";
    case "finished":
      return "finished";
  }
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

  // --- identity: current actor / household -------------------------------
  // The v2 migration always populates `meta.householdId`/`meta.selfUserId`,
  // so the normal path below is a single `meta` read. Cached in the closure
  // after the first read so the five write paths that stamp `actorId`/
  // `householdId` do not each pay a `meta` round trip. Mirrors memoryRepo's
  // never-null, never-throws guarantee: an absent key mints the row on
  // demand exactly as the migration does.

  let cachedHouseholdId: string | null = null;
  let cachedSelfUserId: string | null = null;

  async function currentHouseholdId(): Promise<string> {
    if (cachedHouseholdId) return cachedHouseholdId;
    const conn = await db();
    const rec = await conn.get("meta", "householdId");
    const existing = rec?.value as string | null | undefined;
    if (existing) {
      cachedHouseholdId = existing;
      return existing;
    }
    const ts = now().toISOString();
    const household: Household = { id: newId(), name: null, createdAt: ts, updatedAt: ts, deletedAt: null };
    const tx = conn.transaction(["households", "meta"], "readwrite");
    await tx.objectStore("households").put(household);
    await tx.objectStore("meta").put({ key: "householdId", value: household.id });
    await tx.done;
    cachedHouseholdId = household.id;
    return household.id;
  }

  async function currentActorId(): Promise<string> {
    if (cachedSelfUserId) return cachedSelfUserId;
    const conn = await db();
    const rec = await conn.get("meta", "selfUserId");
    const existing = rec?.value as string | null | undefined;
    if (existing) {
      const row = await conn.get("users", existing);
      if (row) {
        cachedSelfUserId = existing;
        return existing;
      }
    }
    const householdId = await currentHouseholdId();
    const usersInHousehold = await conn.getAllFromIndex("users", "by_householdId", householdId);
    const selfUser = usersInHousehold.find((u) => u.isSelf);
    if (selfUser) {
      cachedSelfUserId = selfUser.id;
      await conn.put("meta", { key: "selfUserId", value: selfUser.id });
      return selfUser.id;
    }
    const ts = now().toISOString();
    const user: User = {
      id: newId(),
      householdId,
      email: null,
      displayName: DEFAULT_SELF_DISPLAY_NAME,
      tint: 1,
      isSelf: true,
      joinedAt: ts,
      createdAt: ts,
      updatedAt: ts,
      deletedAt: null,
    };
    const tx = conn.transaction(["users", "meta"], "readwrite");
    await tx.objectStore("users").put(user);
    await tx.objectStore("meta").put({ key: "selfUserId", value: user.id });
    await tx.done;
    cachedSelfUserId = user.id;
    return user.id;
  }

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
    const householdId = await currentHouseholdId();
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
      householdId,
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
    // Resolved before opening the write transaction below (mirrors `logDose`)
    // — `currentActorId()` may itself open a separate transaction to mint a
    // self user, which must not overlap with the one opened here.
    const actorId = await currentActorId();
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
    const tx = conn.transaction(["courses", "courseEvents", "meta"], "readwrite");
    const metaStore = tx.objectStore("meta");
    // W9 sync (design §D3): the Lamport counter every `CourseEvent` write
    // allocates from, read and rewritten inside this same transaction.
    const seqRec = await metaStore.get("courseEventSeq");
    const seq = ((seqRec?.value as number | undefined) ?? 0) + 1;
    await metaStore.put({ key: "courseEventSeq", value: seq });

    // SPEC §6.4: every course starts life with exactly one "started" event —
    // written here, inside `createCourse`, never by a caller.
    const event: CourseEvent = {
      id: newId(),
      courseId: course.id,
      kind: "started",
      at: course.createdAt,
      seq,
      actorId,
      before: null,
      after: courseSnapshot(course),
      createdAt: ts,
      updatedAt: ts,
      deletedAt: null,
    };
    await tx.objectStore("courses").add(course);
    await tx.objectStore("courseEvents").add(event);
    await tx.done;
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
    const actorId = await currentActorId();
    const conn = await db();
    const tx = conn.transaction(["courses", "courseEvents", "meta"], "readwrite");
    const store = tx.objectStore("courses");
    const existing = assertAlive(await store.get(id), "Course", id);
    const before = courseSnapshot(existing);
    const ts = now().toISOString();
    const updated: Course = { ...existing, ...patch, updatedAt: ts };
    await store.put(updated);
    const after = courseSnapshot(updated);
    // SPEC §6.4: only a genuine schedule or dose change is a lifecycle
    // change — notes/instructions/startDate/endDate alone record nothing.
    const scheduleChanged = JSON.stringify(before.schedule) !== JSON.stringify(after.schedule);
    const doseChanged = before.doseAmount !== after.doseAmount || before.doseUnit !== after.doseUnit;
    if (scheduleChanged || doseChanged) {
      const metaStore = tx.objectStore("meta");
      const seqRec = await metaStore.get("courseEventSeq");
      const seq = ((seqRec?.value as number | undefined) ?? 0) + 1;
      await metaStore.put({ key: "courseEventSeq", value: seq });
      const event: CourseEvent = {
        id: newId(),
        courseId: updated.id,
        kind: "edited",
        at: ts,
        seq,
        actorId,
        before,
        after,
        createdAt: ts,
        updatedAt: ts,
        deletedAt: null,
      };
      await tx.objectStore("courseEvents").add(event);
    }
    await tx.done;
    return updated;
  }

  async function setCourseStatus(id: string, status: CourseStatus): Promise<Course> {
    const actorId = await currentActorId();
    const conn = await db();
    const tx = conn.transaction(["courses", "courseEvents", "meta"], "readwrite");
    const store = tx.objectStore("courses");
    const existing = assertAlive(await store.get(id), "Course", id);
    const before = courseSnapshot(existing);
    const previousStatus = existing.status;
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
    // SPEC §6.4: a genuine transition only — setting the status a course
    // already has records nothing.
    if (status !== previousStatus) {
      const metaStore = tx.objectStore("meta");
      const seqRec = await metaStore.get("courseEventSeq");
      const seq = ((seqRec?.value as number | undefined) ?? 0) + 1;
      await metaStore.put({ key: "courseEventSeq", value: seq });
      const event: CourseEvent = {
        id: newId(),
        courseId: updated.id,
        kind: courseEventKindForStatusChange(status),
        at: ts,
        seq,
        actorId,
        before,
        after: courseSnapshot(updated),
        createdAt: ts,
        updatedAt: ts,
        deletedAt: null,
      };
      await tx.objectStore("courseEvents").add(event);
    }
    await tx.done;
    return updated;
  }

  async function listCourseEvents(filter: {
    courseId?: string;
    courseIds?: string[];
    from?: IsoDateTime;
    to?: IsoDateTime;
    limit?: number;
    newestFirst?: boolean;
  }): Promise<CourseEvent[]> {
    const conn = await db();
    let result: CourseEvent[];
    if (filter.courseId) {
      result = await conn.getAllFromIndex("courseEvents", "by_courseId", filter.courseId);
    } else if (filter.courseIds) {
      const lists = await Promise.all(
        filter.courseIds.map((cid) => conn.getAllFromIndex("courseEvents", "by_courseId", cid)),
      );
      result = lists.flat();
    } else {
      result = await conn.getAll("courseEvents");
    }
    result = result.filter((e) => e.deletedAt === null);
    if (filter.courseId) result = result.filter((e) => e.courseId === filter.courseId);
    if (filter.courseIds) result = result.filter((e) => filter.courseIds!.includes(e.courseId));
    if (filter.from) result = result.filter((e) => e.at >= filter.from!);
    if (filter.to) result = result.filter((e) => e.at <= filter.to!);
    // W9 sync (design §D3): `(at asc, seq asc, id asc)`. `at` stays primary
    // (§6.4 day grouping, W6's event-log tests); `seq` — a Lamport counter
    // stable across devices — replaces the random-UUID `id` as the tie
    // within one instant, with `id` remaining as a last-resort tie only a
    // corrupt/duplicate `seq` could ever reach.
    result = [...result].sort(
      (a, b) => a.at.localeCompare(b.at) || a.seq - b.seq || a.id.localeCompare(b.id),
    );
    if (filter.newestFirst) result.reverse();
    if (filter.limit !== undefined) result = result.slice(0, filter.limit);
    return result;
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

  /**
   * SPEC §5 concurrent-log dedup guard, per CONTRACT.md §6: rows for this
   * course that are not soft-deleted, not superseded by a later
   * `correctDose` row, and whose status is `given` or `skipped` (a `missed`
   * row written by the sweep never blocks a real log). Mirrors memoryRepo's
   * `liveDoseEventsForCourse` exactly.
   */
  function liveDoseEventsForCourse(courseEvents: DoseEvent[]): DoseEvent[] {
    const superseded = new Set(
      courseEvents
        .filter((e) => e.deletedAt === null && e.supersedesId !== null)
        .map((e) => e.supersedesId as string),
    );
    return courseEvents.filter(
      (e) => e.deletedAt === null && !superseded.has(e.id) && (e.status === "given" || e.status === "skipped"),
    );
  }

  async function logDose(input: {
    courseId: string;
    status: "given" | "skipped";
    scheduledFor: IsoDateTime | null;
    givenAt?: IsoDateTime;
    amount: number;
    note?: string;
  }): Promise<DoseEvent> {
    const actorId = await currentActorId();
    const conn = await db();
    // Course read and dose-event read+write share one transaction (courses,
    // doseEvents) so the dedup check and the insert cannot interleave with a
    // concurrent log for the same course.
    const tx = conn.transaction(["courses", "doseEvents"], "readwrite");
    const coursesStore = tx.objectStore("courses");
    const store = tx.objectStore("doseEvents");

    const course = await coursesStore.get(input.courseId);
    if (!course || course.deletedAt !== null) notFound("Course", input.courseId);

    const ts = now().toISOString();
    const givenAt = input.givenAt ?? ts;
    const graceMin = course.schedule.kind === "fixedTimes" ? GRACE_FIXED_MIN : GRACE_INTERVAL_MIN;
    const graceMs = graceMin * 60_000;
    const givenAtMs = new Date(givenAt).getTime();

    const courseEvents = await store.index("by_courseId").getAll(input.courseId);
    const duplicate = liveDoseEventsForCourse(courseEvents).find((e) => {
      if (input.scheduledFor !== null && e.scheduledFor === input.scheduledFor) {
        return true;
      }
      return Math.abs(givenAtMs - new Date(e.givenAt).getTime()) <= graceMs;
    });
    if (duplicate) {
      throw new DuplicateDoseError(duplicate);
    }

    const event: DoseEvent = {
      id: newId(),
      courseId: input.courseId,
      scheduledFor: input.scheduledFor,
      status: input.status,
      loggedAt: ts,
      givenAt,
      amount: input.amount,
      note: input.note ?? null,
      occurrenceKey: occurrenceKeyFor(input.courseId, input.scheduledFor),
      supersedesId: null,
      actorId,
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
    const actorId = await currentActorId();
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
      actorId,
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
    const actorId = await currentActorId();
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
        actorId,
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
    const actorId = await currentActorId();
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
      actorId,
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
    const actorId = await currentActorId();
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
      actorId,
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
      [
        "pets",
        "medications",
        "courses",
        "doseEvents",
        "courseEvents",
        "stockAdjustments",
        "meta",
        "households",
        "users",
      ],
      "readonly",
    );
    const [
      pets,
      meds,
      courses,
      doseEvents,
      courseEvents,
      stockAdjustments,
      households,
      users,
      schemaVersionRec,
      tintCursorRec,
      lastSweepDayRec,
    ] = await Promise.all([
      tx.objectStore("pets").getAll(),
      tx.objectStore("medications").getAll(),
      tx.objectStore("courses").getAll(),
      tx.objectStore("doseEvents").getAll(),
      tx.objectStore("courseEvents").getAll(),
      tx.objectStore("stockAdjustments").getAll(),
      tx.objectStore("households").getAll(),
      tx.objectStore("users").getAll(),
      tx.objectStore("meta").get("schemaVersion"),
      tx.objectStore("meta").get("tintCursor"),
      tx.objectStore("meta").get("lastSweepDay"),
    ]);
    await tx.done;
    // Includes soft-deleted rows in every array — a backup that drops
    // tombstones cannot later sync (SPEC §8). Join codes are deliberately
    // excluded (CONTRACT.md §1): short-lived single-use secrets, not backup
    // material.
    return {
      schemaVersion: (schemaVersionRec?.value as number | undefined) ?? 2,
      exportedAt: now().toISOString(),
      households,
      users,
      pets,
      medications: meds.map(toMedication),
      courses,
      doseEvents,
      courseEvents,
      stockAdjustments,
      meta: {
        tintCursor: (tintCursorRec?.value as number | undefined) ?? 0,
        lastSweepDay: (lastSweepDayRec?.value as MetaShape["lastSweepDay"] | undefined) ?? null,
      },
    };
  }

  /**
   * W9 sync (design §D2/§D4): the single reconciliation rule for both sync
   * and merge-mode `importHousehold`. Mutable entities are last-write-wins
   * on `updatedAt` with a deterministic tie-break on `id`; append-only
   * ledgers are insert-if-absent and never overwritten. Rows land with their
   * incoming `id`/`createdAt`/`updatedAt`/`actorId` intact — this is the one
   * write path that does not stamp `currentActorId()`. A remote medication
   * gains the internal `nameLower` column on the way in, exactly like
   * `createMedication`/`updateMedication`.
   */
  async function applyRemoteChanges(changes: RemoteChanges): Promise<ApplyReport> {
    const conn = await db();
    const tx = conn.transaction(
      ["pets", "medications", "courses", "doseEvents", "stockAdjustments", "courseEvents", "meta"],
      "readwrite",
    );
    const petsStore = tx.objectStore("pets");
    const medsStore = tx.objectStore("medications");
    const coursesStore = tx.objectStore("courses");
    const doseStore = tx.objectStore("doseEvents");
    const stockStore = tx.objectStore("stockAdjustments");
    const courseEventsStore = tx.objectStore("courseEvents");
    const metaStore = tx.objectStore("meta");

    const applied: Record<keyof RemoteChanges, number> = {
      pets: 0,
      medications: 0,
      courses: 0,
      doseEvents: 0,
      stockAdjustments: 0,
      courseEvents: 0,
    };
    let ignored = 0;

    function mutableWins<T extends Timestamped & { id: string }>(incoming: T, existing: T | undefined): boolean {
      if (!existing) return true;
      if (incoming.updatedAt !== existing.updatedAt) return incoming.updatedAt > existing.updatedAt;
      return incoming.id > existing.id;
    }

    async function applyMutable<T extends Timestamped & { id: string }>(
      store: { get(id: string): Promise<T | undefined>; put(row: T): Promise<unknown> },
      incoming: T[] | undefined,
    ): Promise<number> {
      if (!incoming) return 0;
      let count = 0;
      for (const row of incoming) {
        const existing = await store.get(row.id);
        if (mutableWins(row, existing)) {
          await store.put(row);
          count += 1;
        } else {
          ignored += 1;
        }
      }
      return count;
    }

    /** Insert if the id is unheld; never overwrite an id already present. Returns the rows actually inserted. */
    async function applyLedger<T extends { id: string }>(
      store: { get(id: string): Promise<T | undefined>; add(row: T): Promise<unknown> },
      incoming: T[] | undefined,
    ): Promise<T[]> {
      if (!incoming) return [];
      const inserted: T[] = [];
      for (const row of incoming) {
        const existing = await store.get(row.id);
        if (existing) {
          ignored += 1;
          continue;
        }
        await store.add(row);
        inserted.push(row);
      }
      return inserted;
    }

    applied.pets = await applyMutable(petsStore, changes.pets);
    applied.medications = await applyMutable(medsStore, changes.medications?.map(toStoredMedication));
    applied.courses = await applyMutable(coursesStore, changes.courses);

    const insertedDoseEvents = await applyLedger(doseStore, changes.doseEvents);
    applied.doseEvents = insertedDoseEvents.length;
    const insertedStock = await applyLedger(stockStore, changes.stockAdjustments);
    applied.stockAdjustments = insertedStock.length;
    const insertedCourseEvents = await applyLedger(courseEventsStore, changes.courseEvents);
    applied.courseEvents = insertedCourseEvents.length;

    // The Lamport counter jumps to max(local, max seq among the rows just
    // inserted) — never derived from rows we ignored, since an ignored
    // ledger row's id was already held and its seq already accounted for.
    if (insertedCourseEvents.length > 0) {
      const maxIncomingSeq = Math.max(...insertedCourseEvents.map((e) => e.seq));
      const seqRec = await metaStore.get("courseEventSeq");
      const current = (seqRec?.value as number | undefined) ?? 0;
      await metaStore.put({ key: "courseEventSeq", value: Math.max(current, maxIncomingSeq) });
    }

    await tx.done;
    return { applied, ignored };
  }

  async function importHousehold(b: HouseholdBackup, mode: "replace" | "merge"): Promise<ImportReport> {
    // Backfill targets are resolved BEFORE any household/user replacement, so
    // a v1-shaped backup (no `households`/`users` keys, rows lacking
    // `householdId`/`actorId`) backfills against the identity this repo
    // already has, not one import is about to discard.
    const fallbackHouseholdId = await currentHouseholdId();
    const fallbackActorId = await currentActorId();

    const backfillPets = (rows: Pet[]): Pet[] =>
      rows.map((p) => (p.householdId ? p : { ...p, householdId: fallbackHouseholdId }));
    const backfillEvents = (rows: DoseEvent[]): DoseEvent[] =>
      rows.map((e) => (e.actorId ? e : { ...e, actorId: fallbackActorId }));
    const backfillAdjustments = (rows: StockAdjustment[]): StockAdjustment[] =>
      rows.map((a) => (a.actorId ? a : { ...a, actorId: fallbackActorId }));

    if (mode === "replace") {
      const conn = await db();
      const tx = conn.transaction(
        [
          "pets",
          "medications",
          "courses",
          "doseEvents",
          "courseEvents",
          "stockAdjustments",
          "meta",
          "households",
          "users",
        ],
        "readwrite",
      );
      const petsStore = tx.objectStore("pets");
      const medsStore = tx.objectStore("medications");
      const coursesStore = tx.objectStore("courses");
      const eventsStore = tx.objectStore("doseEvents");
      const courseEventsStore = tx.objectStore("courseEvents");
      const stockStore = tx.objectStore("stockAdjustments");
      const metaStore = tx.objectStore("meta");
      const householdsStore = tx.objectStore("households");
      const usersStore = tx.objectStore("users");

      await Promise.all([
        petsStore.clear(),
        medsStore.clear(),
        coursesStore.clear(),
        eventsStore.clear(),
        courseEventsStore.clear(),
        stockStore.clear(),
      ]);
      for (const p of backfillPets(b.pets)) await petsStore.put(p);
      for (const m of b.medications) await medsStore.put(toStoredMedication(m));
      for (const c of b.courses) await coursesStore.put(c);
      for (const e of backfillEvents(b.doseEvents)) await eventsStore.put(e);
      // Optional on `HouseholdBackup` (a v2 backup predates the ledger) —
      // tolerate its absence without inventing rows to fill the gap.
      const restoredCourseEvents = b.courseEvents ?? [];
      for (const ce of restoredCourseEvents) await courseEventsStore.put(ce);
      for (const a of backfillAdjustments(b.stockAdjustments)) await stockStore.put(a);

      // Only replace households/users when the backup actually carries them —
      // a v1 backup has neither key, and the existing rows (and hence the
      // current identity) must survive untouched, exactly as memoryRepo's
      // `household`/`users` variables do when `b.households`/`b.users` are
      // absent.
      let householdId = fallbackHouseholdId;
      if (b.households && b.households[0]) {
        await householdsStore.clear();
        for (const h of b.households) await householdsStore.put(h);
        householdId = b.households[0].id;
      }
      let selfUserId = fallbackActorId;
      if (b.users) {
        await usersStore.clear();
        for (const u of b.users) await usersStore.put(u);
        selfUserId = b.users.find((u) => u.isSelf)?.id ?? fallbackActorId;
      }

      // Transport the real cursor/sweep-day when the backup carries them
      // (a v1 backup written after this fix); fall back to the old,
      // re-derived behaviour for backups written before `meta` existed.
      await metaStore.put({ key: "tintCursor", value: b.meta?.tintCursor ?? b.pets.length });
      await metaStore.put({ key: "schemaVersion", value: b.schemaVersion });
      await metaStore.put({ key: "lastSweepDay", value: b.meta?.lastSweepDay ?? null });
      await metaStore.put({ key: "householdId", value: householdId });
      await metaStore.put({ key: "selfUserId", value: selfUserId });
      // A replace wholesale-replaces `courseEvents` too — the Lamport
      // counter must be reset to match the restored history, not left stale.
      const newCourseEventSeq = restoredCourseEvents.reduce((max, e) => Math.max(max, e.seq), 0);
      await metaStore.put({ key: "courseEventSeq", value: newCourseEventSeq });
      await tx.done;

      // The closure cache must track whatever identity replace just
      // installed — a stale cache would stamp new writes with an id that no
      // longer resolves to a row in this database.
      cachedHouseholdId = householdId;
      cachedSelfUserId = selfUserId;

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

    // W9 sync (design §D2/§D7 item 8): carried item (b) fixed by
    // construction — merge mode routes through the exact same rule sync
    // uses, so an import can no longer overwrite an append-only row.
    const report = await applyRemoteChanges({
      pets: backfillPets(b.pets),
      medications: b.medications,
      courses: b.courses,
      doseEvents: backfillEvents(b.doseEvents),
      stockAdjustments: backfillAdjustments(b.stockAdjustments),
      courseEvents: b.courseEvents ?? [],
    });

    // Households/users/tintCursor merge unchanged — outside `RemoteChanges`'
    // scope, so still handled here directly, in a small transaction of their own.
    if (b.users || (b.households && b.households[0]) || b.meta) {
      const conn = await db();
      const tx = conn.transaction(["households", "users", "meta"], "readwrite");
      const householdsStore = tx.objectStore("households");
      const usersStore = tx.objectStore("users");
      const metaStore = tx.objectStore("meta");

      if (b.users) {
        await mergeRows(
          b.users,
          (id) => usersStore.get(id),
          (row) => usersStore.put(row),
        );
      }
      if (b.households && b.households[0]) {
        await mergeRows(
          b.households,
          (id) => householdsStore.get(id),
          (row) => householdsStore.put(row),
        );
      }
      // Merge only ever moves the cursor forward, and only when the incoming
      // backup actually carries one — an old backup without `meta` must not
      // reset or otherwise perturb the current cursor.
      if (b.meta) {
        const cursorRec = await metaStore.get("tintCursor");
        const currentCursor = (cursorRec?.value as number | undefined) ?? 0;
        await metaStore.put({ key: "tintCursor", value: Math.max(currentCursor, b.meta.tintCursor) });
      }
      await tx.done;
    }

    return {
      mode,
      pets: report.applied.pets,
      medications: report.applied.medications,
      courses: report.applied.courses,
      doseEvents: report.applied.doseEvents,
      stockAdjustments: report.applied.stockAdjustments,
      // Broadened, not shape-changed: `ImportReport`'s five fields above are
      // untouched, but `skipped` now also counts ignored `courseEvents` rows
      // (previously merged silently and uncounted) — the direct consequence
      // of routing every entity through the one `applyRemoteChanges` rule
      // rather than six bespoke `mergeRows` calls. See the W9 report for detail.
      skipped: report.ignored,
    };
  }

  // --- household -----------------------------------------------------

  async function getHousehold(id: string): Promise<Household | null> {
    const h = await (await db()).get("households", id);
    return h && h.deletedAt === null ? h : null;
  }

  async function getCurrentHousehold(): Promise<Household> {
    const id = await currentHouseholdId();
    const h = await (await db()).get("households", id);
    if (!h) notFound("Household", id);
    return h;
  }

  async function updateHousehold(
    id: string,
    patch: Partial<Pick<Household, "name">>,
  ): Promise<Household> {
    const conn = await db();
    const tx = conn.transaction(["households"], "readwrite");
    const store = tx.objectStore("households");
    const existing = assertAlive(await store.get(id), "Household", id);
    const updated: Household = { ...existing, ...patch, updatedAt: now().toISOString() };
    await store.put(updated);
    await tx.done;
    return updated;
  }

  // --- users -----------------------------------------------------------

  async function listUsers(opts?: { includeRemoved?: boolean }): Promise<User[]> {
    const includeRemoved = opts?.includeRemoved ?? false;
    const all = await (await db()).getAll("users");
    return all.filter((u) => includeRemoved || u.deletedAt === null);
  }

  async function getUser(id: string): Promise<User | null> {
    const u = await (await db()).get("users", id);
    return u && u.deletedAt === null ? u : null;
  }

  async function getCurrentUser(): Promise<User> {
    const id = await currentActorId();
    const u = await (await db()).get("users", id);
    if (!u) notFound("User", id);
    return u;
  }

  async function upsertUser(user: User): Promise<User> {
    await (await db()).put("users", user);
    return user;
  }

  async function updateUser(
    id: string,
    patch: Partial<Pick<User, "displayName" | "tint">>,
  ): Promise<User> {
    const conn = await db();
    const tx = conn.transaction(["users"], "readwrite");
    const store = tx.objectStore("users");
    const existing = assertAlive(await store.get(id), "User", id);
    const updated: User = { ...existing, ...patch, updatedAt: now().toISOString() };
    await store.put(updated);
    await tx.done;
    return updated;
  }

  async function removeUser(id: string): Promise<void> {
    // Soft delete: history keeps `actorId`, and `displayNameFor` still
    // resolves the name via `listUsers({ includeRemoved: true })`. Never
    // remove the row.
    const conn = await db();
    const tx = conn.transaction(["users"], "readwrite");
    const store = tx.objectStore("users");
    const existing = assertAlive(await store.get(id), "User", id);
    const ts = now().toISOString();
    await store.put({ ...existing, deletedAt: ts, updatedAt: ts });
    await tx.done;
  }

  // --- join codes --------------------------------------------------------

  async function listJoinCodes(): Promise<JoinCode[]> {
    const all = await (await db()).getAll("joinCodes");
    return all.filter((c) => c.deletedAt === null);
  }

  async function getJoinCodeByCode(code: string): Promise<JoinCode | null> {
    const conn = await db();
    const matches = await conn.getAllFromIndex("joinCodes", "by_code", code);
    const alive = matches.find((c) => c.deletedAt === null);
    return alive ?? null;
  }

  async function createJoinCode(input: { code: string; expiresAt: IsoDateTime }): Promise<JoinCode> {
    const householdId = await currentHouseholdId();
    const createdBy = await currentActorId();
    const conn = await db();
    const tx = conn.transaction(["joinCodes"], "readwrite");
    const store = tx.objectStore("joinCodes");
    const ts = now().toISOString();

    // SPEC §5: one live code at a time — revoke any other live code for the
    // household first. "Live" is `revokedAt === null && usedBy === null`,
    // ignoring `expiresAt` (matches memoryRepo).
    const existingForHousehold = await store.index("by_householdId").getAll(householdId);
    for (const jc of existingForHousehold) {
      if (jc.deletedAt === null && jc.revokedAt === null && jc.usedBy === null) {
        await store.put({ ...jc, revokedAt: ts, updatedAt: ts });
      }
    }

    const joinCode: JoinCode = {
      id: newId(),
      householdId,
      code: input.code,
      createdBy,
      expiresAt: input.expiresAt,
      usedBy: null,
      revokedAt: null,
      createdAt: ts,
      updatedAt: ts,
      deletedAt: null,
    };
    await store.add(joinCode);
    await tx.done;
    return joinCode;
  }

  async function markJoinCodeUsed(id: string, usedBy: string): Promise<JoinCode> {
    const conn = await db();
    const tx = conn.transaction(["joinCodes"], "readwrite");
    const store = tx.objectStore("joinCodes");
    const jc = await store.get(id);
    if (!jc) notFound("JoinCode", id);
    const updated: JoinCode = { ...jc, usedBy, updatedAt: now().toISOString() };
    await store.put(updated);
    await tx.done;
    return updated;
  }

  async function revokeJoinCode(id: string): Promise<JoinCode> {
    const conn = await db();
    const tx = conn.transaction(["joinCodes"], "readwrite");
    const store = tx.objectStore("joinCodes");
    const jc = await store.get(id);
    if (!jc) notFound("JoinCode", id);
    const ts = now().toISOString();
    const updated: JoinCode = { ...jc, revokedAt: ts, updatedAt: ts };
    await store.put(updated);
    await tx.done;
    return updated;
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
    listCourseEvents,
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
    applyRemoteChanges,
    getMeta,
    setMeta,
    currentActorId,
    currentHouseholdId,
    getHousehold,
    getCurrentHousehold,
    updateHousehold,
    listUsers,
    getUser,
    getCurrentUser,
    upsertUser,
    updateUser,
    removeUser,
    listJoinCodes,
    getJoinCodeByCode,
    createJoinCode,
    markJoinCodeUsed,
    revokeJoinCode,
  };
}
