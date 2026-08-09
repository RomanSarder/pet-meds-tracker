// The sample household, constructed from the design kit's presentational
// `ui_kits/petmeds-app/data.js` (Clover, Nugget, Biscuit) but normalized into
// real domain records. The kit's data has no birthdate, no structured
// medication/course fields, and bakes dose amount into a display string
// ("Metacam 0.4 ml") — this file splits that apart: `name` is "Metacam",
// `strength` is a medication-level fact, and "0.4 ml" becomes the course's
// `doseAmount`/`doseUnit`.
//
// This file serves four masters: the memory repo's seed, the engine's test
// corpus, the UI workers' dev data, and the export/import round-trip test.
// Determinism is the whole point — every id and timestamp is a hard-coded
// literal, never `newId()`/`Date.now()`/`Math.random()`, so all four
// downstream branches can snapshot-test against it.
import { occurrenceKeyFor } from "./keys";
import type {
  Course,
  DoseEvent,
  Household,
  JoinCode,
  Medication,
  Pet,
  StockAdjustment,
  User,
} from "./types";

/** 08:00 local (Europe/London BST) on a Saturday. Everything below is relative to this instant. */
export const FIXTURE_NOW = "2026-08-08T07:00:00.000Z";

// --- Household & members -----------------------------------------------
// One household, two members: Roman (self, tint 1) and Marta (tint 2).
// SPEC §5/§11 — attribution across doseEvents/stockAdjustments below is
// split between both so `displayNameFor` has real coverage to resolve.

const HOUSEHOLD_ID = "f0000000-0000-4000-8000-000000000001";
const ROMAN_ID = "g0000000-0000-4000-8000-000000000001";
const MARTA_ID = "g0000000-0000-4000-8000-000000000002";
const JOIN_CODE_ID = "h0000000-0000-4000-8000-000000000001";

const household: Household = {
  id: HOUSEHOLD_ID,
  name: "Home",
  createdAt: "2026-06-01T09:00:00.000Z",
  updatedAt: "2026-06-01T09:00:00.000Z",
  deletedAt: null,
};

const users: User[] = [
  {
    id: ROMAN_ID,
    householdId: HOUSEHOLD_ID,
    email: null,
    displayName: "Roman",
    tint: 1,
    isSelf: true,
    joinedAt: "2026-06-01T09:00:00.000Z",
    createdAt: "2026-06-01T09:00:00.000Z",
    updatedAt: "2026-06-01T09:00:00.000Z",
    deletedAt: null,
  },
  {
    id: MARTA_ID,
    householdId: HOUSEHOLD_ID,
    email: null,
    displayName: "Marta",
    tint: 2,
    isSelf: false,
    joinedAt: "2026-06-02T09:00:00.000Z",
    createdAt: "2026-06-02T09:00:00.000Z",
    updatedAt: "2026-06-02T09:00:00.000Z",
    deletedAt: null,
  },
];

// Every character below is verified to be in JOIN_CODE_ALPHABET by fixtures.test.ts.
const joinCodes: JoinCode[] = [
  {
    id: JOIN_CODE_ID,
    householdId: HOUSEHOLD_ID,
    code: "K7RMQ4",
    createdBy: ROMAN_ID,
    expiresAt: "2026-08-09T07:00:00.000Z",
    usedBy: null,
    revokedAt: null,
    createdAt: "2026-08-08T07:00:00.000Z",
    updatedAt: "2026-08-08T07:00:00.000Z",
    deletedAt: null,
  },
];

// --- Pets ------------------------------------------------------------------
// Clover the rabbit (tint 1), Nugget and Biscuit the guinea pigs (tints 2, 3).

const CLOVER_ID = "a0000000-0000-4000-8000-000000000001";
const NUGGET_ID = "a0000000-0000-4000-8000-000000000002";
const BISCUIT_ID = "a0000000-0000-4000-8000-000000000003";

const pets: Pet[] = [
  {
    id: CLOVER_ID,
    name: "Clover",
    species: "rabbit",
    birthdate: "2023-05-15",
    weightGrams: 1900,
    tint: 1,
    archived: false,
    householdId: HOUSEHOLD_ID,
    createdAt: "2026-06-01T09:00:00.000Z",
    updatedAt: "2026-06-01T09:00:00.000Z",
    deletedAt: null,
  },
  {
    id: NUGGET_ID,
    name: "Nugget",
    species: "guinea_pig",
    birthdate: "2024-07-01",
    weightGrams: 900,
    tint: 2,
    archived: false,
    householdId: HOUSEHOLD_ID,
    createdAt: "2026-06-01T09:00:00.000Z",
    updatedAt: "2026-06-01T09:00:00.000Z",
    deletedAt: null,
  },
  {
    id: BISCUIT_ID,
    name: "Biscuit",
    species: "guinea_pig",
    birthdate: "2024-08-20",
    weightGrams: 1000,
    tint: 3,
    archived: false,
    householdId: HOUSEHOLD_ID,
    createdAt: "2026-06-01T09:00:00.000Z",
    updatedAt: "2026-06-01T09:00:00.000Z",
    deletedAt: null,
  },
];

// --- Medications -------------------------------------------------------
// stockUnits is a hand-computed cache of that medication's StockAdjustment
// rows below (Σ deltaUnits) — kept in sync by the fixtures.test.ts invariant.

const METACAM_ID = "b0000000-0000-4000-8000-000000000001";
const METOCLOPRAMIDE_ID = "b0000000-0000-4000-8000-000000000002";
const VITAMIN_C_ID = "b0000000-0000-4000-8000-000000000003";
/** Shared between a Nugget course and a Biscuit course — the case the data layer must not get wrong. */
const IVERMECTIN_ID = "b0000000-0000-4000-8000-000000000004";
const BAYTRIL_ID = "b0000000-0000-4000-8000-000000000005";

const medications: Medication[] = [
  {
    id: METACAM_ID,
    name: "Metacam",
    strength: "1.5 mg/ml",
    form: "liquid",
    unit: "ml",
    packSize: 15,
    stockUnits: 3.3,
    lowThreshold: null,
    createdAt: "2026-06-01T09:00:00.000Z",
    updatedAt: "2026-08-01T09:00:00.000Z",
    deletedAt: null,
  },
  {
    id: METOCLOPRAMIDE_ID,
    name: "Metoclopramide",
    strength: "5 mg/ml",
    form: "liquid",
    unit: "ml",
    packSize: 15,
    stockUnits: 30,
    lowThreshold: null,
    createdAt: "2026-06-01T09:00:00.000Z",
    updatedAt: "2026-07-15T09:00:00.000Z",
    deletedAt: null,
  },
  {
    id: VITAMIN_C_ID,
    name: "Vitamin C",
    strength: "50 mg",
    form: "tablet",
    unit: "tab",
    packSize: 60,
    stockUnits: 54,
    lowThreshold: 10,
    createdAt: "2026-06-01T09:00:00.000Z",
    updatedAt: "2026-08-01T09:00:00.000Z",
    deletedAt: null,
  },
  {
    id: IVERMECTIN_ID,
    name: "Ivermectin",
    strength: "1% w/v",
    form: "liquid",
    unit: "drop",
    packSize: 10,
    stockUnits: 3.8,
    lowThreshold: null,
    createdAt: "2026-06-01T09:00:00.000Z",
    updatedAt: "2026-08-05T09:00:00.000Z",
    deletedAt: null,
  },
  {
    id: BAYTRIL_ID,
    name: "Baytril",
    strength: "25 mg/ml",
    form: "liquid",
    unit: "ml",
    packSize: 10,
    stockUnits: 4.4,
    lowThreshold: null,
    createdAt: "2026-06-01T09:00:00.000Z",
    updatedAt: "2026-08-02T09:00:00.000Z",
    deletedAt: null,
  },
];

// --- Courses -------------------------------------------------------------
// Coverage: both Schedule kinds; fixedTimes plain / with daysOfWeek / with
// everyNDays; a fromLastDose course with history and one never started; a
// course with an endDate; a non-active (stopped) status.

const COURSE_CLOVER_METACAM = "c0000000-0000-4000-8000-000000000001";
const COURSE_CLOVER_METOCLOPRAMIDE = "c0000000-0000-4000-8000-000000000002";
const COURSE_NUGGET_VITAMIN_C = "c0000000-0000-4000-8000-000000000003";
const COURSE_NUGGET_METACAM = "c0000000-0000-4000-8000-000000000004";
const COURSE_NUGGET_IVERMECTIN = "c0000000-0000-4000-8000-000000000005";
const COURSE_BISCUIT_IVERMECTIN = "c0000000-0000-4000-8000-000000000006";
/** fromLastDose, never started: no `given` DoseEvent references it at all (SPEC §3b). */
const COURSE_BISCUIT_METOCLOPRAMIDE = "c0000000-0000-4000-8000-000000000007";
const COURSE_CLOVER_BAYTRIL = "c0000000-0000-4000-8000-000000000008";

const courses: Course[] = [
  {
    id: COURSE_CLOVER_METACAM,
    petId: CLOVER_ID,
    medicationId: METACAM_ID,
    doseAmount: 0.4,
    doseUnit: "ml",
    instructions: "after food",
    schedule: { kind: "fixedTimes", times: ["08:00", "20:00"] },
    startDate: "2026-08-06",
    endDate: "2026-08-12",
    status: "active",
    notes: null,
    resumedAt: null,
    createdAt: "2026-08-06T08:00:00.000Z",
    updatedAt: "2026-08-06T08:00:00.000Z",
    deletedAt: null,
  },
  {
    id: COURSE_CLOVER_METOCLOPRAMIDE,
    petId: CLOVER_ID,
    medicationId: METOCLOPRAMIDE_ID,
    doseAmount: 0.5,
    doseUnit: "ml",
    instructions: null,
    schedule: { kind: "fromLastDose", intervalHours: 8 },
    startDate: "2026-08-01",
    endDate: null,
    status: "active",
    notes: null,
    resumedAt: null,
    createdAt: "2026-08-01T08:00:00.000Z",
    updatedAt: "2026-08-01T08:00:00.000Z",
    deletedAt: null,
  },
  {
    id: COURSE_NUGGET_VITAMIN_C,
    petId: NUGGET_ID,
    medicationId: VITAMIN_C_ID,
    doseAmount: 50,
    doseUnit: "mg",
    instructions: null,
    schedule: { kind: "fixedTimes", times: ["09:00"] },
    startDate: "2026-06-01",
    endDate: null,
    status: "active",
    notes: null,
    resumedAt: null,
    createdAt: "2026-06-01T08:00:00.000Z",
    updatedAt: "2026-06-01T08:00:00.000Z",
    deletedAt: null,
  },
  {
    id: COURSE_NUGGET_METACAM,
    petId: NUGGET_ID,
    medicationId: METACAM_ID,
    doseAmount: 0.2,
    doseUnit: "ml",
    instructions: "after food",
    schedule: { kind: "fixedTimes", times: ["09:00"], everyNDays: 2 },
    startDate: "2026-08-04",
    endDate: "2026-08-13",
    status: "active",
    notes: null,
    resumedAt: null,
    createdAt: "2026-08-04T08:00:00.000Z",
    updatedAt: "2026-08-04T08:00:00.000Z",
    deletedAt: null,
  },
  {
    id: COURSE_NUGGET_IVERMECTIN,
    petId: NUGGET_ID,
    medicationId: IVERMECTIN_ID,
    doseAmount: 2,
    doseUnit: "drop",
    instructions: null,
    // [6] = Saturday, ISO numbering (1 = Monday) — not JS getDay().
    schedule: { kind: "fixedTimes", times: ["07:00"], daysOfWeek: [6] },
    startDate: "2026-05-02",
    endDate: null,
    status: "active",
    notes: null,
    resumedAt: null,
    createdAt: "2026-05-02T08:00:00.000Z",
    updatedAt: "2026-05-02T08:00:00.000Z",
    deletedAt: null,
  },
  {
    id: COURSE_BISCUIT_IVERMECTIN,
    petId: BISCUIT_ID,
    medicationId: IVERMECTIN_ID,
    doseAmount: 2,
    doseUnit: "drop",
    instructions: null,
    schedule: { kind: "fixedTimes", times: ["07:00"], daysOfWeek: [6] },
    startDate: "2026-05-02",
    endDate: null,
    status: "active",
    notes: null,
    resumedAt: null,
    createdAt: "2026-05-02T08:00:00.000Z",
    updatedAt: "2026-05-02T08:00:00.000Z",
    deletedAt: null,
  },
  {
    id: COURSE_BISCUIT_METOCLOPRAMIDE,
    petId: BISCUIT_ID,
    medicationId: METOCLOPRAMIDE_ID,
    doseAmount: 0.2,
    doseUnit: "ml",
    instructions: null,
    schedule: { kind: "fromLastDose", intervalHours: 12 },
    startDate: "2026-08-08",
    endDate: null,
    status: "active",
    notes: null,
    resumedAt: null,
    createdAt: "2026-08-08T07:00:00.000Z",
    updatedAt: "2026-08-08T07:00:00.000Z",
    deletedAt: null,
  },
  {
    id: COURSE_CLOVER_BAYTRIL,
    petId: CLOVER_ID,
    medicationId: BAYTRIL_ID,
    doseAmount: 0.3,
    doseUnit: "ml",
    instructions: "after food",
    schedule: { kind: "fixedTimes", times: ["08:00", "20:00"] },
    startDate: "2026-08-01",
    // SPEC §3c: `stopped` is a user action that sets endDate = today.
    endDate: "2026-08-08",
    status: "stopped",
    notes: "Discontinued by vet",
    resumedAt: null,
    createdAt: "2026-08-01T08:00:00.000Z",
    updatedAt: "2026-08-08T07:00:00.000Z",
    deletedAt: null,
  },
];

// --- Dose events -----------------------------------------------------------
// At least one given, one skipped, one missed; every occurrenceKey follows
// `${courseId}|${scheduledFor ?? "-"}`; supersedesId is null throughout since
// none of these has been corrected.

const doseEvents: DoseEvent[] = [
  {
    id: "d0000000-0000-4000-8000-000000000001",
    courseId: COURSE_CLOVER_METACAM,
    scheduledFor: "2026-08-06T07:00:00.000Z", // 08:00 BST, two days ago
    status: "skipped",
    loggedAt: "2026-08-06T07:05:00.000Z",
    givenAt: "2026-08-06T07:05:00.000Z",
    amount: 0.4,
    note: "Vomited after breakfast — skipped on vet advice",
    occurrenceKey: occurrenceKeyFor(COURSE_CLOVER_METACAM, "2026-08-06T07:00:00.000Z"),
    supersedesId: null,
    actorId: ROMAN_ID,
    createdAt: "2026-08-06T07:05:00.000Z",
    updatedAt: "2026-08-06T07:05:00.000Z",
    deletedAt: null,
  },
  {
    id: "d0000000-0000-4000-8000-000000000002",
    courseId: COURSE_CLOVER_METACAM,
    scheduledFor: "2026-08-07T19:00:00.000Z", // 20:00 BST yesterday
    status: "given",
    loggedAt: "2026-08-07T18:58:00.000Z",
    givenAt: "2026-08-07T18:58:00.000Z",
    amount: 0.4,
    note: null,
    occurrenceKey: occurrenceKeyFor(COURSE_CLOVER_METACAM, "2026-08-07T19:00:00.000Z"),
    supersedesId: null,
    actorId: ROMAN_ID,
    createdAt: "2026-08-07T18:58:00.000Z",
    updatedAt: "2026-08-07T18:58:00.000Z",
    deletedAt: null,
  },
  {
    id: "d0000000-0000-4000-8000-000000000003",
    courseId: COURSE_CLOVER_BAYTRIL,
    scheduledFor: "2026-08-07T19:00:00.000Z", // 20:00 BST yesterday
    status: "given",
    loggedAt: "2026-08-07T19:04:00.000Z",
    givenAt: "2026-08-07T19:04:00.000Z",
    amount: 0.3,
    note: null,
    occurrenceKey: occurrenceKeyFor(COURSE_CLOVER_BAYTRIL, "2026-08-07T19:00:00.000Z"),
    supersedesId: null,
    actorId: ROMAN_ID,
    createdAt: "2026-08-07T19:04:00.000Z",
    updatedAt: "2026-08-07T19:04:00.000Z",
    deletedAt: null,
  },
  {
    id: "d0000000-0000-4000-8000-000000000004",
    courseId: COURSE_CLOVER_METOCLOPRAMIDE,
    // Chain start: the very first fromLastDose log has no scheduledFor.
    scheduledFor: null,
    status: "given",
    loggedAt: "2026-08-06T22:00:00.000Z",
    givenAt: "2026-08-06T22:00:00.000Z",
    amount: 0.5,
    note: null,
    occurrenceKey: occurrenceKeyFor(COURSE_CLOVER_METOCLOPRAMIDE, null),
    supersedesId: null,
    actorId: ROMAN_ID,
    createdAt: "2026-08-06T22:00:00.000Z",
    updatedAt: "2026-08-06T22:00:00.000Z",
    deletedAt: null,
  },
  {
    id: "d0000000-0000-4000-8000-000000000005",
    courseId: COURSE_NUGGET_METACAM,
    scheduledFor: "2026-08-06T08:00:00.000Z", // 09:00 BST two days ago
    status: "missed",
    // Written by the daily sweep, 12h after due.
    loggedAt: "2026-08-06T20:00:00.000Z",
    givenAt: "2026-08-06T20:00:00.000Z",
    amount: 0.2,
    note: null,
    occurrenceKey: occurrenceKeyFor(COURSE_NUGGET_METACAM, "2026-08-06T08:00:00.000Z"),
    supersedesId: null,
    actorId: MARTA_ID,
    createdAt: "2026-08-06T20:00:00.000Z",
    updatedAt: "2026-08-06T20:00:00.000Z",
    deletedAt: null,
  },
  {
    id: "d0000000-0000-4000-8000-000000000006",
    courseId: COURSE_NUGGET_IVERMECTIN,
    scheduledFor: "2026-08-08T06:00:00.000Z", // 07:00 BST today (Saturday)
    status: "given",
    loggedAt: "2026-08-08T06:10:00.000Z",
    givenAt: "2026-08-08T06:10:00.000Z",
    amount: 2,
    note: null,
    occurrenceKey: occurrenceKeyFor(COURSE_NUGGET_IVERMECTIN, "2026-08-08T06:00:00.000Z"),
    supersedesId: null,
    actorId: MARTA_ID,
    createdAt: "2026-08-08T06:10:00.000Z",
    updatedAt: "2026-08-08T06:10:00.000Z",
    deletedAt: null,
  },
  {
    id: "d0000000-0000-4000-8000-000000000007",
    courseId: COURSE_BISCUIT_IVERMECTIN,
    scheduledFor: "2026-08-08T06:00:00.000Z", // 07:00 BST today (Saturday)
    status: "given",
    loggedAt: "2026-08-08T06:12:00.000Z",
    givenAt: "2026-08-08T06:12:00.000Z",
    amount: 2,
    note: null,
    occurrenceKey: occurrenceKeyFor(COURSE_BISCUIT_IVERMECTIN, "2026-08-08T06:00:00.000Z"),
    supersedesId: null,
    actorId: MARTA_ID,
    createdAt: "2026-08-08T06:12:00.000Z",
    updatedAt: "2026-08-08T06:12:00.000Z",
    deletedAt: null,
  },
  {
    id: "d0000000-0000-4000-8000-000000000008",
    courseId: COURSE_NUGGET_VITAMIN_C,
    scheduledFor: "2026-08-07T08:00:00.000Z", // 09:00 BST yesterday
    status: "given",
    loggedAt: "2026-08-07T08:02:00.000Z",
    givenAt: "2026-08-07T08:02:00.000Z",
    amount: 50,
    note: null,
    occurrenceKey: occurrenceKeyFor(COURSE_NUGGET_VITAMIN_C, "2026-08-07T08:00:00.000Z"),
    supersedesId: null,
    actorId: MARTA_ID,
    createdAt: "2026-08-07T08:02:00.000Z",
    updatedAt: "2026-08-07T08:02:00.000Z",
    deletedAt: null,
  },
];

// --- Stock adjustments -----------------------------------------------------
// Append-only ledger; each medication's stockUnits above equals the sum of
// its rows here (verified by fixtures.test.ts).

const stockAdjustments: StockAdjustment[] = [
  {
    id: "e0000000-0000-4000-8000-000000000001",
    medicationId: METACAM_ID,
    deltaUnits: 15,
    reason: "purchase",
    note: "New 15 ml bottle",
    actorId: ROMAN_ID,
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:00.000Z",
    deletedAt: null,
  },
  {
    id: "e0000000-0000-4000-8000-000000000002",
    medicationId: METACAM_ID,
    deltaUnits: -11.7,
    reason: "correction",
    note: "Counted bottle, less than expected",
    actorId: ROMAN_ID,
    createdAt: "2026-08-01T09:00:00.000Z",
    updatedAt: "2026-08-01T09:00:00.000Z",
    deletedAt: null,
  },
  {
    id: "e0000000-0000-4000-8000-000000000003",
    medicationId: METOCLOPRAMIDE_ID,
    deltaUnits: 30,
    reason: "purchase",
    note: "Two 15 ml bottles",
    actorId: ROMAN_ID,
    createdAt: "2026-07-15T09:00:00.000Z",
    updatedAt: "2026-07-15T09:00:00.000Z",
    deletedAt: null,
  },
  {
    id: "e0000000-0000-4000-8000-000000000004",
    medicationId: VITAMIN_C_ID,
    deltaUnits: 60,
    reason: "purchase",
    note: "60-tablet pack",
    actorId: ROMAN_ID,
    createdAt: "2026-07-10T09:00:00.000Z",
    updatedAt: "2026-07-10T09:00:00.000Z",
    deletedAt: null,
  },
  {
    id: "e0000000-0000-4000-8000-000000000005",
    medicationId: VITAMIN_C_ID,
    deltaUnits: -6,
    reason: "correction",
    note: "Recount",
    actorId: ROMAN_ID,
    createdAt: "2026-08-01T09:00:00.000Z",
    updatedAt: "2026-08-01T09:00:00.000Z",
    deletedAt: null,
  },
  {
    id: "e0000000-0000-4000-8000-000000000006",
    medicationId: IVERMECTIN_ID,
    deltaUnits: 10,
    reason: "purchase",
    note: "New vial",
    actorId: MARTA_ID,
    createdAt: "2026-07-01T09:00:00.000Z",
    updatedAt: "2026-07-01T09:00:00.000Z",
    deletedAt: null,
  },
  {
    id: "e0000000-0000-4000-8000-000000000007",
    medicationId: IVERMECTIN_ID,
    deltaUnits: -6.2,
    reason: "correction",
    note: "Recount — shared between two pets",
    actorId: MARTA_ID,
    createdAt: "2026-08-05T09:00:00.000Z",
    updatedAt: "2026-08-05T09:00:00.000Z",
    deletedAt: null,
  },
  {
    id: "e0000000-0000-4000-8000-000000000008",
    medicationId: BAYTRIL_ID,
    deltaUnits: 10,
    reason: "purchase",
    note: "New 10 ml bottle",
    actorId: MARTA_ID,
    createdAt: "2026-07-18T09:00:00.000Z",
    updatedAt: "2026-07-18T09:00:00.000Z",
    deletedAt: null,
  },
  {
    id: "e0000000-0000-4000-8000-000000000009",
    medicationId: BAYTRIL_ID,
    deltaUnits: -5.6,
    reason: "correction",
    note: "Recount",
    actorId: MARTA_ID,
    createdAt: "2026-08-02T09:00:00.000Z",
    updatedAt: "2026-08-02T09:00:00.000Z",
    deletedAt: null,
  },
];

export interface FixtureData {
  household: Household;
  users: User[];
  joinCodes: JoinCode[];
  pets: Pet[];
  medications: Medication[];
  courses: Course[];
  doseEvents: DoseEvent[];
  stockAdjustments: StockAdjustment[];
}

export const fixtures: FixtureData = {
  household,
  users,
  joinCodes,
  pets,
  medications,
  courses,
  doseEvents,
  stockAdjustments,
};

/** Deep copy so a repo seeded from `fixtures` cannot mutate the shared constant. */
export function cloneFixtures(): FixtureData {
  return structuredClone(fixtures);
}
