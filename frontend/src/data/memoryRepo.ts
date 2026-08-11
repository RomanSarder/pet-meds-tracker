// A complete, honest in-memory implementation of `Repo`. This is what the UI
// workers develop and test against; W1 (slice 2) later ships `createIdbRepo`
// against the same interface. Every invariant enforced here (append-only
// dose history, cached stockUnits, monotonic tint cursor, bounded-window
// retraction, the concurrent-log dedup guard) is the same invariant the
// IndexedDB repo must enforce, so nothing here is "just for tests".
import type {
  Course,
  CourseEvent,
  CourseEventKind,
  CourseSnapshot,
  CourseStatus,
  DoseEvent,
  DoseEventStatus,
  FixtureData,
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
  cloneFixtures,
  DEFAULT_SELF_DISPLAY_NAME,
  GRACE_FIXED_MIN,
  GRACE_INTERVAL_MIN,
  localDayKey,
  newId,
  now,
  occurrenceKeyFor,
  TINT_COUNT,
  UNDO_WINDOW_MS,
  RETRACT_GRACE_MS,
} from "@/domain";
import type { ApplyReport, RemoteChanges, Repo } from "./repo.types";
import { DuplicateDoseError, RetractWindowExpiredError } from "./errors";

export { DuplicateDoseError, RetractWindowExpiredError } from "./errors";

function stamp(): IsoDateTime {
  return now().toISOString();
}

function notFound(label: string, id: string): never {
  throw new Error(`${label} not found: ${id}`);
}

function mintHousehold(): Household {
  const ts = stamp();
  return { id: newId(), name: null, createdAt: ts, updatedAt: ts, deletedAt: null };
}

/**
 * SPEC §6.4's ledger snapshot — only the fields a detail line can render.
 * Deep-cloned so a snapshot embedded in a `CourseEvent` can never be mutated
 * by later changes to the live `Course` row it was taken from.
 */
function courseSnapshot(course: Course): CourseSnapshot {
  return structuredClone({
    schedule: course.schedule,
    doseAmount: course.doseAmount,
    doseUnit: course.doseUnit,
    startDate: course.startDate,
    endDate: course.endDate,
  });
}

/**
 * `setCourseStatus` only ever calls this once it has already confirmed
 * `status !== course.status`, so `status` is always the transition's
 * destination and never a no-op. SPEC's rule table collapses to a plain
 * mapping on the destination alone: every non-`active` status the course
 * could have been in before an `-> active` transition ("paused", "finished"
 * or "stopped") means the same thing — "resumed".
 */
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

function mintSelfUser(householdId: string): User {
  const ts = stamp();
  return {
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
}

export function createMemoryRepo(seed?: Partial<FixtureData>): Repo {
  // `structuredClone` on the caller's seed (or `cloneFixtures()` for the
  // default fixture constant) so the shared source can never be mutated by
  // this store, and so the store can never be mutated by anyone holding a
  // reference to the object they passed in.
  const source: Partial<FixtureData> = seed ? structuredClone(seed) : cloneFixtures();

  let pets: Pet[] = source.pets ?? [];
  let medications: Medication[] = source.medications ?? [];
  let courses: Course[] = source.courses ?? [];
  let doseEvents: DoseEvent[] = source.doseEvents ?? [];
  let stockAdjustments: StockAdjustment[] = source.stockAdjustments ?? [];
  let joinCodes: JoinCode[] = source.joinCodes ?? [];

  // A seed that omits `household`/`users` (the ~20 pre-existing call sites
  // that only ever passed the five original arrays) mints them exactly as
  // the v1->v2 migration does, rather than pulling in the fixture
  // household/members it never asked for.
  let household: Household = source.household ?? mintHousehold();
  let users: User[] = source.users ?? [mintSelfUser(household.id)];

  // Cursor starts consistent with however many pets were seeded, assuming
  // (as our own fixtures do) that they were assigned tints 1..N in creation
  // order starting from cursor 0. A caller seeding out-of-band data with a
  // different tint layout gets a cursor that is merely a reasonable guess,
  // documented here rather than silently "fixed".
  const meta: MetaShape = {
    schemaVersion: 4,
    tintCursor: pets.length,
    lastSweepDay: null,
    selfUserId: users.find((u) => u.isSelf)?.id ?? null,
    householdId: household.id,
    courseEventSeq: 0,
    syncCursor: null,
    lastPushedAt: null,
    selfAliasIdsPushed: null,
  };

  /** W9 sync (design §D3): the Lamport counter every `CourseEvent` write allocates from. */
  function nextCourseEventSeq(): number {
    meta.courseEventSeq += 1;
    return meta.courseEventSeq;
  }

  // `createMemoryRepo(fixtures)` (and every custom seed) puts courses
  // directly into `courses` above, bypassing `createCourse` entirely, so
  // those rows would otherwise have no ledger history at all. Synthesize one
  // "started" event per seeded course — the memoryRepo mirror of exactly
  // what the idbRepo's v2->v3 migration backfills for a pre-existing course
  // row (`meta.selfUserId` is the same source `currentActorId()` reads).
  let courseEvents: CourseEvent[] = courses.map((course) => ({
    id: newId(),
    courseId: course.id,
    kind: "started",
    at: course.createdAt,
    seq: 0, // placeholder — assigned in (at, id) order just below, mirroring the v3->v4 backfill
    actorId: meta.selfUserId ?? "",
    before: null,
    after: courseSnapshot(course),
    createdAt: stamp(),
    updatedAt: stamp(),
    deletedAt: null,
  }));
  // Deterministic seq assignment for the synthesized rows above — same (at,
  // id) ordering rule db.ts's v3->v4 upgrade uses — so `meta.courseEventSeq`
  // starts consistent with however many "started" events were just minted.
  [...courseEvents]
    .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
    .forEach((event) => {
      event.seq = nextCourseEventSeq();
    });

  // --- small internal helpers ------------------------------------------

  function findAlive<T extends Timestamped>(arr: T[], id: string): T | undefined {
    return arr.find((r) => (r as unknown as { id: string }).id === id && r.deletedAt === null);
  }

  function requireAlive<T extends Timestamped & { id: string }>(arr: T[], id: string, label: string): T {
    const row = arr.find((r) => r.id === id && r.deletedAt === null);
    if (!row) notFound(label, id);
    return row;
  }

  // --- identity: current actor / household -------------------------------

  async function currentHouseholdId(): Promise<string> {
    if (meta.householdId && meta.householdId === household.id) {
      return meta.householdId;
    }
    // Absent in practice (the constructor above always sets one), but never
    // throws — a repo caught without one mints it on demand.
    household = mintHousehold();
    meta.householdId = household.id;
    return household.id;
  }

  async function currentActorId(): Promise<string> {
    if (meta.selfUserId && users.some((u) => u.id === meta.selfUserId)) {
      return meta.selfUserId;
    }
    const existing = users.find((u) => u.isSelf);
    if (existing) {
      meta.selfUserId = existing.id;
      return existing.id;
    }
    const householdId = await currentHouseholdId();
    const user = mintSelfUser(householdId);
    users.push(user);
    meta.selfUserId = user.id;
    return user.id;
  }

  // See `Repo.reconcileSelfId`'s doc comment (repo.types.ts) for the full
  // rationale — this mirrors `idbRepo`'s implementation exactly, minus the
  // transaction machinery an in-memory store doesn't need.
  async function reconcileSelfId(canonicalId: string): Promise<{ changed: boolean }> {
    const localId = await currentActorId();
    if (localId === canonicalId) {
      return { changed: false };
    }
    const idx = users.findIndex((u) => u.id === localId);
    if (idx !== -1) {
      const existing = users[idx];
      const priorAliasIds = existing.aliasIds ?? [];
      const nextAliasIds = priorAliasIds.includes(localId) ? priorAliasIds : [...priorAliasIds, localId];
      users[idx] = { ...existing, id: canonicalId, aliasIds: nextAliasIds, updatedAt: stamp() };
    }
    meta.selfUserId = canonicalId;
    return { changed: true };
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
    const householdId = await currentHouseholdId();
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
    // SPEC §6.4: every course starts life with exactly one "started" event —
    // written here, inside `createCourse`, never by a caller.
    const actorId = await currentActorId();
    courseEvents.push({
      id: newId(),
      courseId: course.id,
      kind: "started",
      at: course.createdAt,
      seq: nextCourseEventSeq(),
      actorId,
      before: null,
      after: courseSnapshot(course),
      createdAt: stamp(),
      updatedAt: stamp(),
      deletedAt: null,
    });
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
    const before = courseSnapshot(course);
    Object.assign(course, structuredClone(patch), { updatedAt: stamp() });
    const after = courseSnapshot(course);
    // SPEC §6.4: only a genuine schedule or dose change is a lifecycle
    // change — notes/instructions/startDate/endDate alone record nothing.
    const scheduleChanged = JSON.stringify(before.schedule) !== JSON.stringify(after.schedule);
    const doseChanged = before.doseAmount !== after.doseAmount || before.doseUnit !== after.doseUnit;
    if (scheduleChanged || doseChanged) {
      const actorId = await currentActorId();
      courseEvents.push({
        id: newId(),
        courseId: course.id,
        kind: "edited",
        at: stamp(),
        seq: nextCourseEventSeq(),
        actorId,
        before,
        after,
        createdAt: stamp(),
        updatedAt: stamp(),
        deletedAt: null,
      });
    }
    return structuredClone(course);
  }

  async function setCourseStatus(id: string, status: CourseStatus): Promise<Course> {
    const course = requireAlive(courses, id, "Course");
    const before = courseSnapshot(course);
    const previousStatus = course.status;
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
    // SPEC §6.4: a genuine transition only — setting the status a course
    // already has records nothing.
    if (status !== previousStatus) {
      const actorId = await currentActorId();
      courseEvents.push({
        id: newId(),
        courseId: course.id,
        kind: courseEventKindForStatusChange(status),
        at: stamp(),
        seq: nextCourseEventSeq(),
        actorId,
        before,
        after: courseSnapshot(course),
        createdAt: stamp(),
        updatedAt: stamp(),
        deletedAt: null,
      });
    }
    return structuredClone(course);
  }

  async function listCourseEvents(filter: {
    courseId?: string;
    courseIds?: string[];
    from?: IsoDateTime;
    to?: IsoDateTime;
    limit?: number;
    newestFirst?: boolean;
  }): Promise<CourseEvent[]> {
    let result = courseEvents.filter((e) => e.deletedAt === null);
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
    return structuredClone(result);
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

  /**
   * SPEC §5 concurrent-log dedup guard, live per CONTRACT.md §6: rows for
   * this course that are not soft-deleted, not superseded by a later
   * `correctDose` row, and whose status is `given` or `skipped` (a `missed`
   * row written by the sweep never blocks a real log).
   */
  function liveDoseEventsForCourse(courseId: string): DoseEvent[] {
    const superseded = new Set(
      doseEvents
        .filter((e) => e.deletedAt === null && e.supersedesId !== null)
        .map((e) => e.supersedesId as string),
    );
    return doseEvents.filter(
      (e) =>
        e.courseId === courseId &&
        e.deletedAt === null &&
        !superseded.has(e.id) &&
        (e.status === "given" || e.status === "skipped"),
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
    const course = requireAlive(courses, input.courseId, "Course");
    const actorId = await currentActorId();
    const ts = stamp();
    const givenAt = input.givenAt ?? ts;

    const graceMin = course.schedule.kind === "fixedTimes" ? GRACE_FIXED_MIN : GRACE_INTERVAL_MIN;
    const graceMs = graceMin * 60_000;
    const givenAtMs = new Date(givenAt).getTime();
    const duplicate = liveDoseEventsForCourse(input.courseId).find((e) => {
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
    doseEvents.push(event);
    return structuredClone(event);
  }

  async function correctDose(
    originalId: string,
    patch: { givenAt?: IsoDateTime; amount?: number; status?: DoseEventStatus; note?: string },
  ): Promise<DoseEvent> {
    const original = doseEvents.find((e) => e.id === originalId);
    if (!original) notFound("DoseEvent", originalId);
    const actorId = await currentActorId();
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
      actorId,
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
    // delete, not a soft delete and not a compensating row. Because the row
    // is truly gone, the dedup guard above cannot see it either — retracting
    // never permanently poisons an occurrence.
    doseEvents.splice(idx, 1);
  }

  async function recordMissed(
    inputs: Array<{ courseId: string; scheduledFor: IsoDateTime; amount: number }>,
  ): Promise<DoseEvent[]> {
    const actorId = await currentActorId();
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
        actorId,
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
    const actorId = await currentActorId();
    const ts = stamp();
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

  // --- household -----------------------------------------------------

  async function getHousehold(id: string): Promise<Household | null> {
    return household.id === id && household.deletedAt === null ? structuredClone(household) : null;
  }

  async function getCurrentHousehold(): Promise<Household> {
    await currentHouseholdId();
    return structuredClone(household);
  }

  async function updateHousehold(
    id: string,
    patch: Partial<Pick<Household, "name">>,
  ): Promise<Household> {
    if (household.id !== id || household.deletedAt !== null) notFound("Household", id);
    Object.assign(household, patch, { updatedAt: stamp() });
    return structuredClone(household);
  }

  // --- users -----------------------------------------------------------

  async function listUsers(opts?: { includeRemoved?: boolean }): Promise<User[]> {
    const includeRemoved = opts?.includeRemoved ?? false;
    return structuredClone(users.filter((u) => includeRemoved || u.deletedAt === null));
  }

  async function getUser(id: string): Promise<User | null> {
    const u = findAlive(users, id);
    return u ? structuredClone(u) : null;
  }

  async function getCurrentUser(): Promise<User> {
    const id = await currentActorId();
    const u = users.find((x) => x.id === id);
    if (!u) notFound("User", id);
    return structuredClone(u);
  }

  async function upsertUser(user: User): Promise<User> {
    const cloned = structuredClone(user);
    const idx = users.findIndex((u) => u.id === user.id);
    if (idx === -1) {
      users.push(cloned);
    } else {
      users[idx] = cloned;
    }
    return structuredClone(cloned);
  }

  async function updateUser(
    id: string,
    patch: Partial<Pick<User, "displayName" | "tint">>,
  ): Promise<User> {
    const user = requireAlive(users, id, "User");
    Object.assign(user, patch, { updatedAt: stamp() });
    return structuredClone(user);
  }

  async function removeUser(id: string): Promise<void> {
    // Soft delete: history keeps `actorId`, and `displayNameFor` still
    // resolves the name via `listUsers({ includeRemoved: true })`. Never
    // splice the row out.
    const user = requireAlive(users, id, "User");
    const ts = stamp();
    user.deletedAt = ts;
    user.updatedAt = ts;
  }

  // --- join codes --------------------------------------------------------

  async function listJoinCodes(): Promise<JoinCode[]> {
    return structuredClone(joinCodes.filter((c) => c.deletedAt === null));
  }

  async function getJoinCodeByCode(code: string): Promise<JoinCode | null> {
    const c = joinCodes.find((jc) => jc.code === code && jc.deletedAt === null);
    return c ? structuredClone(c) : null;
  }

  async function createJoinCode(input: { code: string; expiresAt: IsoDateTime }): Promise<JoinCode> {
    const householdId = await currentHouseholdId();
    const createdBy = await currentActorId();
    const ts = stamp();
    // SPEC §5: one live code at a time — revoke any other live code for the
    // household before minting the new one.
    for (const jc of joinCodes) {
      if (
        jc.householdId === householdId &&
        jc.deletedAt === null &&
        jc.revokedAt === null &&
        jc.usedBy === null
      ) {
        jc.revokedAt = ts;
        jc.updatedAt = ts;
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
    joinCodes.push(joinCode);
    return structuredClone(joinCode);
  }

  async function markJoinCodeUsed(id: string, usedBy: string): Promise<JoinCode> {
    const jc = joinCodes.find((c) => c.id === id);
    if (!jc) notFound("JoinCode", id);
    jc.usedBy = usedBy;
    jc.updatedAt = stamp();
    return structuredClone(jc);
  }

  async function revokeJoinCode(id: string): Promise<JoinCode> {
    const jc = joinCodes.find((c) => c.id === id);
    if (!jc) notFound("JoinCode", id);
    jc.revokedAt = stamp();
    jc.updatedAt = stamp();
    return structuredClone(jc);
  }

  // --- backup / restore ---------------------------------------------------

  async function exportHousehold(): Promise<HouseholdBackup> {
    return structuredClone({
      schemaVersion: meta.schemaVersion,
      exportedAt: stamp(),
      households: [household],
      users,
      pets,
      medications,
      courses,
      doseEvents,
      courseEvents,
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

  /**
   * W9 sync (design §D2/§D4): the single reconciliation rule for both sync
   * and merge-mode `importHousehold`. Mutable entities are last-write-wins
   * on `updatedAt` with a deterministic tie-break on `id`; append-only
   * ledgers are insert-if-absent and never overwritten. Rows land with their
   * incoming `id`/`createdAt`/`updatedAt`/`actorId` intact — this is the one
   * write path that does not stamp `currentActorId()`.
   */
  async function applyRemoteChanges(changes: RemoteChanges): Promise<ApplyReport> {
    const applied: Record<keyof RemoteChanges, number> = {
      pets: 0,
      medications: 0,
      courses: 0,
      doseEvents: 0,
      stockAdjustments: 0,
      courseEvents: 0,
    };
    let ignored = 0;

    /** Mutable rows: `incoming` wins over `existing` on newer `updatedAt`, tie-broken by greater `id`. */
    function mutableWins<T extends Timestamped & { id: string }>(incoming: T, existing: T | undefined): boolean {
      if (!existing) return true;
      if (incoming.updatedAt !== existing.updatedAt) return incoming.updatedAt > existing.updatedAt;
      return incoming.id > existing.id;
    }

    function applyMutable<T extends Timestamped & { id: string }>(
      current: T[],
      incoming: T[] | undefined,
      key: keyof RemoteChanges,
    ): T[] {
      if (!incoming) return current;
      const byId = new Map(current.map((r) => [r.id, r]));
      let count = 0;
      for (const row of incoming) {
        const existing = byId.get(row.id);
        if (mutableWins(row, existing)) {
          byId.set(row.id, structuredClone(row));
          count += 1;
        } else {
          ignored += 1;
        }
      }
      applied[key] = count;
      return Array.from(byId.values());
    }

    /** Append-only ledgers: insert if the id is unheld, never overwrite an id already present. */
    function applyLedger<T extends { id: string }>(
      current: T[],
      incoming: T[] | undefined,
      key: keyof RemoteChanges,
    ): { rows: T[]; inserted: T[] } {
      if (!incoming) return { rows: current, inserted: [] };
      const ids = new Set(current.map((r) => r.id));
      const rows = [...current];
      const inserted: T[] = [];
      for (const row of incoming) {
        if (ids.has(row.id)) {
          ignored += 1;
          continue;
        }
        ids.add(row.id);
        rows.push(structuredClone(row));
        inserted.push(row);
      }
      applied[key] = inserted.length;
      return { rows, inserted };
    }

    pets = applyMutable(pets, changes.pets, "pets");
    medications = applyMutable(medications, changes.medications, "medications");
    courses = applyMutable(courses, changes.courses, "courses");

    const doseR = applyLedger(doseEvents, changes.doseEvents, "doseEvents");
    doseEvents = doseR.rows;
    const stockR = applyLedger(stockAdjustments, changes.stockAdjustments, "stockAdjustments");
    stockAdjustments = stockR.rows;
    const courseEventsR = applyLedger(courseEvents, changes.courseEvents, "courseEvents");
    courseEvents = courseEventsR.rows;

    // The Lamport counter jumps to max(local, max seq among the rows just
    // inserted) — never derived from rows we ignored, since an ignored
    // ledger row's id was already held and its seq already accounted for.
    if (courseEventsR.inserted.length > 0) {
      const maxIncomingSeq = Math.max(...courseEventsR.inserted.map((e) => e.seq));
      meta.courseEventSeq = Math.max(meta.courseEventSeq, maxIncomingSeq);
    }

    return { applied, ignored };
  }

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
  async function resetLocalHousehold(): Promise<void> {
    pets = [];
    medications = [];
    courses = [];
    doseEvents = [];
    stockAdjustments = [];
    courseEvents = [];
    joinCodes = [];

    household = mintHousehold();
    const user = mintSelfUser(household.id);
    users = [user];

    meta.tintCursor = 0;
    meta.lastSweepDay = null;
    meta.courseEventSeq = 0;
    meta.syncCursor = null;
    meta.lastPushedAt = null;
    meta.householdId = household.id;
    meta.selfUserId = user.id;
  }

  async function importHousehold(b: HouseholdBackup, mode: "replace" | "merge"): Promise<ImportReport> {
    // Backfill targets are read BEFORE any household/user replacement, so a
    // v1-shaped backup (no `households`/`users` keys) backfills against the
    // identity this repo already has, not one import is about to discard.
    const fallbackHouseholdId = await currentHouseholdId();
    const fallbackActorId = await currentActorId();

    const backfillPets = (rows: Pet[]): Pet[] =>
      rows.map((p) => (p.householdId ? p : { ...p, householdId: fallbackHouseholdId }));
    const backfillEvents = (rows: DoseEvent[]): DoseEvent[] =>
      rows.map((e) => (e.actorId ? e : { ...e, actorId: fallbackActorId }));
    const backfillAdjustments = (rows: StockAdjustment[]): StockAdjustment[] =>
      rows.map((a) => (a.actorId ? a : { ...a, actorId: fallbackActorId }));

    if (mode === "replace") {
      if (b.households && b.households[0]) {
        household = structuredClone(b.households[0]);
      }
      if (b.users) {
        users = structuredClone(b.users);
      }
      pets = backfillPets(structuredClone(b.pets));
      medications = structuredClone(b.medications);
      courses = structuredClone(b.courses);
      doseEvents = backfillEvents(structuredClone(b.doseEvents));
      // `courseEvents` is optional on `HouseholdBackup` (a v2 backup predates
      // the ledger) — tolerate its absence without inventing rows to fill
      // the gap, exactly like every other optional field on this type.
      courseEvents = b.courseEvents ? structuredClone(b.courseEvents) : [];
      stockAdjustments = backfillAdjustments(structuredClone(b.stockAdjustments));
      meta.schemaVersion = b.schemaVersion;
      // Transport the real cursor/sweep-day when the backup carries them
      // (a v1 backup written after this fix); fall back to the old,
      // re-derived behaviour for backups written before `meta` existed.
      meta.tintCursor = b.meta?.tintCursor ?? pets.length;
      meta.lastSweepDay = b.meta?.lastSweepDay ?? null;
      meta.householdId = household.id;
      meta.selfUserId = users.find((u) => u.isSelf)?.id ?? meta.selfUserId;
      // The counter this database's own restored history implies — a
      // replace wipes and reinstalls `courseEvents` wholesale, so the
      // Lamport counter must be reset to match rather than left stale.
      meta.courseEventSeq = courseEvents.reduce((max, e) => Math.max(max, e.seq), 0);
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

    if (b.users) {
      users = mergeArray(users, b.users).merged;
    }
    if (b.households && b.households[0]) {
      household = mergeArray([household], b.households).merged[0] ?? household;
    }

    // Merge only ever moves the cursor forward, and only when the incoming
    // backup actually carries one — an old backup without `meta` must not
    // reset or otherwise perturb the current cursor.
    if (b.meta) {
      meta.tintCursor = Math.max(meta.tintCursor, b.meta.tintCursor);
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
      // rather than five bespoke ones. See the W9 report for detail.
      skipped: report.ignored,
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
    resetLocalHousehold,
    applyRemoteChanges,
    getMeta,
    setMeta,
    currentActorId,
    reconcileSelfId,
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
