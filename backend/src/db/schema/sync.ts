import { relations, sql } from "drizzle-orm";
import { bigint, boolean, date, integer, jsonb, numeric, pgSequence, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { households } from "./households";

// W9-DESIGN §D5: one shared replication watermark for every sync table. `sync_seq`
// is a monotonically increasing Postgres sequence, not an entity id — nothing may
// key off it except the pull cursor (SPEC §9 forbids logic keyed on server-assigned
// ids). Every table below defaults `sync_seq` from this one sequence, and the push
// route bumps it again on every LWW-accepted update (sync/index.ts), so a client's
// cursor advances across all six tables in one global order.
export const syncSeq = pgSequence("sync_seq");

const SYNC_SEQ_DEFAULT = sql`nextval('sync_seq')`;

// Shared shape note: every table below carries `id` (the CLIENT's uuid — never
// `.defaultRandom()`, SPEC §9), `household_id` (the only FK — see below),
// `sync_seq`, and `created_at`/`updated_at`/`deleted_at`. There is deliberately
// no cross-domain FK (course -> pet, dose_event -> course, ...): rows arrive out
// of order during reconciliation and the client is the authority on referential
// integrity, so an FK here would reject a legitimate push whose parent hasn't
// landed yet (W9-DESIGN §D5).

export const pets = pgTable("pets", {
  id: uuid().primaryKey(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id),
  syncSeq: bigint("sync_seq", { mode: "number" }).notNull().default(SYNC_SEQ_DEFAULT),
  name: text().notNull(),
  species: text().notNull(),
  birthdate: date({ mode: "string" }),
  weightGrams: integer("weight_grams"),
  tint: integer().notNull(),
  archived: boolean().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const petsRelations = relations(pets, ({ one }) => ({
  household: one(households, { fields: [pets.householdId], references: [households.id] }),
}));

export const medications = pgTable("medications", {
  id: uuid().primaryKey(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id),
  syncSeq: bigint("sync_seq", { mode: "number" }).notNull().default(SYNC_SEQ_DEFAULT),
  name: text().notNull(),
  strength: text(),
  form: text().notNull(),
  unit: text().notNull(),
  packSize: numeric("pack_size", { mode: "number" }),
  stockUnits: numeric("stock_units", { mode: "number" }),
  lowThreshold: numeric("low_threshold", { mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const medicationsRelations = relations(medications, ({ one }) => ({
  household: one(households, { fields: [medications.householdId], references: [households.id] }),
}));

export const courses = pgTable("courses", {
  id: uuid().primaryKey(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id),
  syncSeq: bigint("sync_seq", { mode: "number" }).notNull().default(SYNC_SEQ_DEFAULT),
  petId: uuid("pet_id").notNull(),
  medicationId: uuid("medication_id").notNull(),
  doseAmount: numeric("dose_amount", { mode: "number" }).notNull(),
  doseUnit: text("dose_unit").notNull(),
  instructions: text(),
  // schedule and course-event snapshots are jsonb (W9-DESIGN §D5).
  schedule: jsonb().notNull(),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }),
  status: text().notNull(),
  notes: text(),
  resumedAt: timestamp("resumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const coursesRelations = relations(courses, ({ one }) => ({
  household: one(households, { fields: [courses.householdId], references: [households.id] }),
}));

export const doseEvents = pgTable("dose_events", {
  id: uuid().primaryKey(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id),
  syncSeq: bigint("sync_seq", { mode: "number" }).notNull().default(SYNC_SEQ_DEFAULT),
  courseId: uuid("course_id").notNull(),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
  status: text().notNull(),
  loggedAt: timestamp("logged_at", { withTimezone: true }).notNull(),
  givenAt: timestamp("given_at", { withTimezone: true }).notNull(),
  amount: numeric({ mode: "number" }).notNull(),
  note: text(),
  occurrenceKey: text("occurrence_key").notNull(),
  supersedesId: uuid("supersedes_id"),
  actorId: uuid("actor_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const doseEventsRelations = relations(doseEvents, ({ one }) => ({
  household: one(households, { fields: [doseEvents.householdId], references: [households.id] }),
}));

export const stockAdjustments = pgTable("stock_adjustments", {
  id: uuid().primaryKey(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id),
  syncSeq: bigint("sync_seq", { mode: "number" }).notNull().default(SYNC_SEQ_DEFAULT),
  medicationId: uuid("medication_id").notNull(),
  deltaUnits: numeric("delta_units", { mode: "number" }).notNull(),
  reason: text().notNull(),
  note: text(),
  actorId: uuid("actor_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const stockAdjustmentsRelations = relations(stockAdjustments, ({ one }) => ({
  household: one(households, { fields: [stockAdjustments.householdId], references: [households.id] }),
}));

// Carries W9-DESIGN §D3's Lamport `seq` — the ordering tie-break alongside `at`.
// `before`/`after` are point-in-time snapshots (jsonb), not references, so they
// keep rendering correctly regardless of what the live `courses` row looks like now.
export const courseEvents = pgTable("course_events", {
  id: uuid().primaryKey(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id),
  syncSeq: bigint("sync_seq", { mode: "number" }).notNull().default(SYNC_SEQ_DEFAULT),
  courseId: uuid("course_id").notNull(),
  kind: text().notNull(),
  at: timestamp({ withTimezone: true }).notNull(),
  actorId: uuid("actor_id").notNull(),
  before: jsonb(),
  after: jsonb().notNull(),
  seq: integer().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const courseEventsRelations = relations(courseEvents, ({ one }) => ({
  household: one(households, { fields: [courseEvents.householdId], references: [households.id] }),
}));
