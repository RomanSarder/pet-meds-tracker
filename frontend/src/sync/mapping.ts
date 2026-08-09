// W9-DESIGN §D5/§D6 — the ONE place domain rows are mapped to/from the wire
// DTOs in `@pet-tracker/shared`. Every conversion below is a field-by-field
// object literal typed against its target interface, in BOTH directions:
// that is what makes a later domain or DTO change surface as a compile error
// here rather than a silently dropped column — TypeScript rejects an object
// literal that is missing a field its target type requires.
//
// `householdId` is the one field that never appears on the wire (it is
// stamped from the session on the backend, W9-DESIGN §D5) — `Pet` is the
// only domain type that carries it, so it is the only `*FromDto` that takes
// a `householdId` parameter to reattach it locally.
import type {
  Course,
  CourseEvent,
  CourseSnapshot,
  DoseEvent,
  Medication,
  Pet,
  Schedule,
  StockAdjustment,
} from "@/domain";
import type { RemoteChanges } from "@/data";
import type {
  CourseDto,
  CourseEventDto,
  CourseSnapshotDto,
  DoseEventDto,
  MedicationDto,
  PetDto,
  ScheduleDto,
  StockAdjustmentDto,
  SyncPayload,
} from "@pet-tracker/shared";

function scheduleToDto(s: Schedule): ScheduleDto {
  switch (s.kind) {
    case "fixedTimes":
      return {
        kind: "fixedTimes",
        times: s.times,
        daysOfWeek: s.daysOfWeek,
        everyNDays: s.everyNDays,
      };
    case "fromLastDose":
      return { kind: "fromLastDose", intervalHours: s.intervalHours, anchorTime: s.anchorTime };
  }
}

function scheduleFromDto(s: ScheduleDto): Schedule {
  switch (s.kind) {
    case "fixedTimes":
      return {
        kind: "fixedTimes",
        times: s.times,
        daysOfWeek: s.daysOfWeek,
        everyNDays: s.everyNDays,
      };
    case "fromLastDose":
      return { kind: "fromLastDose", intervalHours: s.intervalHours, anchorTime: s.anchorTime };
  }
}

function courseSnapshotToDto(s: CourseSnapshot): CourseSnapshotDto {
  return {
    schedule: scheduleToDto(s.schedule),
    doseAmount: s.doseAmount,
    doseUnit: s.doseUnit,
    startDate: s.startDate,
    endDate: s.endDate,
  };
}

function courseSnapshotFromDto(s: CourseSnapshotDto): CourseSnapshot {
  return {
    schedule: scheduleFromDto(s.schedule),
    doseAmount: s.doseAmount,
    doseUnit: s.doseUnit,
    startDate: s.startDate,
    endDate: s.endDate,
  };
}

export function petToDto(p: Pet): PetDto {
  return {
    id: p.id,
    name: p.name,
    species: p.species,
    birthdate: p.birthdate,
    weightGrams: p.weightGrams,
    tint: p.tint,
    archived: p.archived,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    deletedAt: p.deletedAt,
  };
}

export function petFromDto(dto: PetDto, householdId: string): Pet {
  return {
    id: dto.id,
    householdId,
    name: dto.name,
    species: dto.species,
    birthdate: dto.birthdate,
    weightGrams: dto.weightGrams,
    tint: dto.tint,
    archived: dto.archived,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    deletedAt: dto.deletedAt,
  };
}

export function medicationToDto(m: Medication): MedicationDto {
  return {
    id: m.id,
    name: m.name,
    strength: m.strength,
    form: m.form,
    unit: m.unit,
    packSize: m.packSize,
    stockUnits: m.stockUnits,
    lowThreshold: m.lowThreshold,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    deletedAt: m.deletedAt,
  };
}

export function medicationFromDto(dto: MedicationDto): Medication {
  return {
    id: dto.id,
    name: dto.name,
    strength: dto.strength,
    form: dto.form,
    unit: dto.unit,
    packSize: dto.packSize,
    stockUnits: dto.stockUnits,
    lowThreshold: dto.lowThreshold,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    deletedAt: dto.deletedAt,
  };
}

export function courseToDto(c: Course): CourseDto {
  return {
    id: c.id,
    petId: c.petId,
    medicationId: c.medicationId,
    doseAmount: c.doseAmount,
    doseUnit: c.doseUnit,
    instructions: c.instructions,
    schedule: scheduleToDto(c.schedule),
    startDate: c.startDate,
    endDate: c.endDate,
    status: c.status,
    notes: c.notes,
    resumedAt: c.resumedAt,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    deletedAt: c.deletedAt,
  };
}

export function courseFromDto(dto: CourseDto): Course {
  return {
    id: dto.id,
    petId: dto.petId,
    medicationId: dto.medicationId,
    doseAmount: dto.doseAmount,
    doseUnit: dto.doseUnit,
    instructions: dto.instructions,
    schedule: scheduleFromDto(dto.schedule),
    startDate: dto.startDate,
    endDate: dto.endDate,
    status: dto.status,
    notes: dto.notes,
    resumedAt: dto.resumedAt,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    deletedAt: dto.deletedAt,
  };
}

export function doseEventToDto(e: DoseEvent): DoseEventDto {
  return {
    id: e.id,
    courseId: e.courseId,
    scheduledFor: e.scheduledFor,
    status: e.status,
    loggedAt: e.loggedAt,
    givenAt: e.givenAt,
    amount: e.amount,
    note: e.note,
    occurrenceKey: e.occurrenceKey,
    supersedesId: e.supersedesId,
    actorId: e.actorId,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    deletedAt: e.deletedAt,
  };
}

export function doseEventFromDto(dto: DoseEventDto): DoseEvent {
  return {
    id: dto.id,
    courseId: dto.courseId,
    scheduledFor: dto.scheduledFor,
    status: dto.status,
    loggedAt: dto.loggedAt,
    givenAt: dto.givenAt,
    amount: dto.amount,
    note: dto.note,
    occurrenceKey: dto.occurrenceKey,
    supersedesId: dto.supersedesId,
    actorId: dto.actorId,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    deletedAt: dto.deletedAt,
  };
}

export function stockAdjustmentToDto(a: StockAdjustment): StockAdjustmentDto {
  return {
    id: a.id,
    medicationId: a.medicationId,
    deltaUnits: a.deltaUnits,
    reason: a.reason,
    note: a.note,
    actorId: a.actorId,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    deletedAt: a.deletedAt,
  };
}

export function stockAdjustmentFromDto(dto: StockAdjustmentDto): StockAdjustment {
  return {
    id: dto.id,
    medicationId: dto.medicationId,
    deltaUnits: dto.deltaUnits,
    reason: dto.reason,
    note: dto.note,
    actorId: dto.actorId,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    deletedAt: dto.deletedAt,
  };
}

export function courseEventToDto(e: CourseEvent): CourseEventDto {
  return {
    id: e.id,
    courseId: e.courseId,
    kind: e.kind,
    at: e.at,
    actorId: e.actorId,
    before: e.before ? courseSnapshotToDto(e.before) : null,
    after: courseSnapshotToDto(e.after),
    seq: e.seq,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    deletedAt: e.deletedAt,
  };
}

export function courseEventFromDto(dto: CourseEventDto): CourseEvent {
  return {
    id: dto.id,
    courseId: dto.courseId,
    kind: dto.kind,
    at: dto.at,
    actorId: dto.actorId,
    before: dto.before ? courseSnapshotFromDto(dto.before) : null,
    after: courseSnapshotFromDto(dto.after),
    seq: dto.seq,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    deletedAt: dto.deletedAt,
  };
}

/** The rows a local push round selected, keyed the same way `RemoteChanges` is. */
export interface LocalChanges {
  pets: Pet[];
  medications: Medication[];
  courses: Course[];
  doseEvents: DoseEvent[];
  stockAdjustments: StockAdjustment[];
  courseEvents: CourseEvent[];
}

/** Domain rows selected for push -> the wire payload. Empty arrays are omitted, matching
 *  `SyncPayload`'s "absent/empty means nothing of that kind in this batch" convention. */
export function domainToPayload(rows: LocalChanges): SyncPayload {
  const payload: SyncPayload = {};
  if (rows.pets.length > 0) payload.pets = rows.pets.map(petToDto);
  if (rows.medications.length > 0) payload.medications = rows.medications.map(medicationToDto);
  if (rows.courses.length > 0) payload.courses = rows.courses.map(courseToDto);
  if (rows.doseEvents.length > 0) payload.doseEvents = rows.doseEvents.map(doseEventToDto);
  if (rows.stockAdjustments.length > 0) {
    payload.stockAdjustments = rows.stockAdjustments.map(stockAdjustmentToDto);
  }
  if (rows.courseEvents.length > 0) payload.courseEvents = rows.courseEvents.map(courseEventToDto);
  return payload;
}

/** A pulled wire payload -> `Repo.applyRemoteChanges`'s input shape. */
export function payloadToRemoteChanges(payload: SyncPayload, householdId: string): RemoteChanges {
  const changes: RemoteChanges = {};
  if (payload.pets) changes.pets = payload.pets.map((dto) => petFromDto(dto, householdId));
  if (payload.medications) changes.medications = payload.medications.map(medicationFromDto);
  if (payload.courses) changes.courses = payload.courses.map(courseFromDto);
  if (payload.doseEvents) changes.doseEvents = payload.doseEvents.map(doseEventFromDto);
  if (payload.stockAdjustments) {
    changes.stockAdjustments = payload.stockAdjustments.map(stockAdjustmentFromDto);
  }
  if (payload.courseEvents) changes.courseEvents = payload.courseEvents.map(courseEventFromDto);
  return changes;
}
