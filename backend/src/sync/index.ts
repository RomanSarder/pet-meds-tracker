import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fastifyPlugin from "fastify-plugin";
import { and, asc, eq, getTableColumns, gt, sql, SQL } from "drizzle-orm";
import { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import {
  CourseDto,
  CourseEventDto,
  DoseEventDto,
  MedicationDto,
  PetDto,
  StockAdjustmentDto,
  SyncPayload,
  SyncPullResult,
  SyncPushBody,
  SyncPushResult,
} from "@pet-tracker/shared";
import {
  courseEvents,
  courses,
  doseEvents,
  medications,
  pets,
  stockAdjustments,
  users,
} from "../db/schema";
import authenticatePlugin from "../auth/authenticate-plugin";

// W9-DESIGN §D5: page size for GET /sync/pull. A table whose result reaches
// exactly this many rows is presumed truncated — see the cursor rule below.
const PULL_LIMIT = 500;

function iso(value: Date): string {
  return value.toISOString();
}

function isoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function dateOrNull(value: string | null): Date | null {
  return value ? new Date(value) : null;
}

// --------------------------------------------------------------------------
// Per-table row <-> DTO conversion. Unavoidably one pair per table (the domain
// shapes genuinely differ); everything that touches the database — the actual
// SELECT/INSERT/ON CONFLICT statements — is generic and lives once, below.
// --------------------------------------------------------------------------

function petToDto(row: typeof pets.$inferSelect): PetDto {
  return {
    id: row.id,
    name: row.name,
    species: row.species as PetDto["species"],
    birthdate: row.birthdate,
    weightGrams: row.weightGrams,
    tint: row.tint as PetDto["tint"],
    archived: row.archived,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    deletedAt: isoOrNull(row.deletedAt),
  };
}

function petFromDto(dto: PetDto, householdId: string): typeof pets.$inferInsert {
  return {
    id: dto.id,
    householdId,
    name: dto.name,
    species: dto.species,
    birthdate: dto.birthdate,
    weightGrams: dto.weightGrams,
    tint: dto.tint,
    archived: dto.archived,
    createdAt: new Date(dto.createdAt),
    updatedAt: new Date(dto.updatedAt),
    deletedAt: dateOrNull(dto.deletedAt),
  };
}

function medicationToDto(row: typeof medications.$inferSelect): MedicationDto {
  return {
    id: row.id,
    name: row.name,
    strength: row.strength,
    form: row.form as MedicationDto["form"],
    unit: row.unit,
    packSize: row.packSize,
    stockUnits: row.stockUnits,
    lowThreshold: row.lowThreshold,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    deletedAt: isoOrNull(row.deletedAt),
  };
}

function medicationFromDto(dto: MedicationDto, householdId: string): typeof medications.$inferInsert {
  return {
    id: dto.id,
    householdId,
    name: dto.name,
    strength: dto.strength,
    form: dto.form,
    unit: dto.unit,
    packSize: dto.packSize,
    stockUnits: dto.stockUnits,
    lowThreshold: dto.lowThreshold,
    createdAt: new Date(dto.createdAt),
    updatedAt: new Date(dto.updatedAt),
    deletedAt: dateOrNull(dto.deletedAt),
  };
}

function courseToDto(row: typeof courses.$inferSelect): CourseDto {
  return {
    id: row.id,
    petId: row.petId,
    medicationId: row.medicationId,
    doseAmount: row.doseAmount,
    doseUnit: row.doseUnit,
    instructions: row.instructions,
    schedule: row.schedule as CourseDto["schedule"],
    startDate: row.startDate,
    endDate: row.endDate,
    status: row.status as CourseDto["status"],
    notes: row.notes,
    resumedAt: isoOrNull(row.resumedAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    deletedAt: isoOrNull(row.deletedAt),
  };
}

function courseFromDto(dto: CourseDto, householdId: string): typeof courses.$inferInsert {
  return {
    id: dto.id,
    householdId,
    petId: dto.petId,
    medicationId: dto.medicationId,
    doseAmount: dto.doseAmount,
    doseUnit: dto.doseUnit,
    instructions: dto.instructions,
    schedule: dto.schedule,
    startDate: dto.startDate,
    endDate: dto.endDate,
    status: dto.status,
    notes: dto.notes,
    resumedAt: dateOrNull(dto.resumedAt),
    createdAt: new Date(dto.createdAt),
    updatedAt: new Date(dto.updatedAt),
    deletedAt: dateOrNull(dto.deletedAt),
  };
}

function doseEventToDto(row: typeof doseEvents.$inferSelect): DoseEventDto {
  return {
    id: row.id,
    courseId: row.courseId,
    scheduledFor: isoOrNull(row.scheduledFor),
    status: row.status as DoseEventDto["status"],
    loggedAt: iso(row.loggedAt),
    givenAt: iso(row.givenAt),
    amount: row.amount,
    note: row.note,
    occurrenceKey: row.occurrenceKey,
    supersedesId: row.supersedesId,
    actorId: row.actorId,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    deletedAt: isoOrNull(row.deletedAt),
  };
}

function doseEventFromDto(dto: DoseEventDto, householdId: string): typeof doseEvents.$inferInsert {
  return {
    id: dto.id,
    householdId,
    courseId: dto.courseId,
    scheduledFor: dateOrNull(dto.scheduledFor),
    status: dto.status,
    loggedAt: new Date(dto.loggedAt),
    givenAt: new Date(dto.givenAt),
    amount: dto.amount,
    note: dto.note,
    occurrenceKey: dto.occurrenceKey,
    supersedesId: dto.supersedesId,
    actorId: dto.actorId,
    createdAt: new Date(dto.createdAt),
    updatedAt: new Date(dto.updatedAt),
    deletedAt: dateOrNull(dto.deletedAt),
  };
}

function stockAdjustmentToDto(row: typeof stockAdjustments.$inferSelect): StockAdjustmentDto {
  return {
    id: row.id,
    medicationId: row.medicationId,
    deltaUnits: row.deltaUnits,
    reason: row.reason as StockAdjustmentDto["reason"],
    note: row.note,
    actorId: row.actorId,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    deletedAt: isoOrNull(row.deletedAt),
  };
}

function stockAdjustmentFromDto(dto: StockAdjustmentDto, householdId: string): typeof stockAdjustments.$inferInsert {
  return {
    id: dto.id,
    householdId,
    medicationId: dto.medicationId,
    deltaUnits: dto.deltaUnits,
    reason: dto.reason,
    note: dto.note,
    actorId: dto.actorId,
    createdAt: new Date(dto.createdAt),
    updatedAt: new Date(dto.updatedAt),
    deletedAt: dateOrNull(dto.deletedAt),
  };
}

function courseEventToDto(row: typeof courseEvents.$inferSelect): CourseEventDto {
  return {
    id: row.id,
    courseId: row.courseId,
    kind: row.kind as CourseEventDto["kind"],
    at: iso(row.at),
    actorId: row.actorId,
    before: row.before as CourseEventDto["before"],
    after: row.after as CourseEventDto["after"],
    seq: row.seq,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    deletedAt: isoOrNull(row.deletedAt),
  };
}

function courseEventFromDto(dto: CourseEventDto, householdId: string): typeof courseEvents.$inferInsert {
  return {
    id: dto.id,
    householdId,
    courseId: dto.courseId,
    kind: dto.kind,
    at: new Date(dto.at),
    actorId: dto.actorId,
    before: dto.before,
    after: dto.after,
    seq: dto.seq,
    createdAt: new Date(dto.createdAt),
    updatedAt: new Date(dto.updatedAt),
    deletedAt: dateOrNull(dto.deletedAt),
  };
}

// --------------------------------------------------------------------------
// W9-DESIGN §D5: the table registry. `household_id` enters a query in exactly
// ONE place — the generic `pushTable`/`pullTable` functions below — not once
// per route. Adding a seventh table means adding one line here.
// --------------------------------------------------------------------------

type SyncTableKey = keyof SyncPayload;

/** The four columns every sync table shares — enough for the generic query logic. */
type SyncTable = PgTable & {
  id: AnyPgColumn;
  householdId: AnyPgColumn;
  syncSeq: AnyPgColumn;
  updatedAt: AnyPgColumn;
};

interface SyncTableSpec {
  key: SyncTableKey;
  table: SyncTable;
  kind: "mutable" | "ledger";
  toDto: (row: any) => any;
  fromDto: (dto: any, householdId: string) => any;
}

const SYNC_TABLES: readonly SyncTableSpec[] = [
  { key: "pets", table: pets, kind: "mutable", toDto: petToDto, fromDto: petFromDto },
  { key: "medications", table: medications, kind: "mutable", toDto: medicationToDto, fromDto: medicationFromDto },
  { key: "courses", table: courses, kind: "mutable", toDto: courseToDto, fromDto: courseFromDto },
  { key: "doseEvents", table: doseEvents, kind: "ledger", toDto: doseEventToDto, fromDto: doseEventFromDto },
  {
    key: "stockAdjustments",
    table: stockAdjustments,
    kind: "ledger",
    toDto: stockAdjustmentToDto,
    fromDto: stockAdjustmentFromDto,
  },
  { key: "courseEvents", table: courseEvents, kind: "ledger", toDto: courseEventToDto, fromDto: courseEventFromDto },
];

/**
 * Resolves the caller's household from their session. 404s and returns null
 * when the caller has no household, or isn't a user at all — every sync route
 * calls this first and stamps its result as `household_id`, never reading one
 * from the request body (W9-DESIGN §D5).
 */
async function requireHousehold(
  fastify: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<string | null> {
  const [user] = await fastify.db.select().from(users).where(eq(users.id, request.userId));
  if (!user || !user.householdId) {
    reply.notFound();
    return null;
  }
  return user.householdId;
}

/**
 * Builds the `set` clause for a mutable table's `ON CONFLICT ... DO UPDATE`:
 * every domain column (and `updated_at`/`created_at`/`deleted_at`) copied from
 * `excluded`, plus a fresh `sync_seq` so an LWW-accepted update also advances
 * the replication watermark. `id`, `household_id` and `sync_seq` itself are
 * excluded from the generic copy — household_id in particular must never be
 * reassigned by an update.
 */
function excludedSetClause(table: SyncTable): Record<string, SQL> {
  const columns = getTableColumns(table);
  const set: Record<string, SQL> = { syncSeq: sql`nextval('sync_seq')` };
  for (const [key, column] of Object.entries(columns)) {
    if (key === "id" || key === "householdId" || key === "syncSeq") continue;
    // Safe to inline: `column.name` is one of our own schema's physical column
    // names, never client input.
    set[key] = sql.raw(`excluded.${(column as AnyPgColumn).name}`);
  }
  return set;
}

/**
 * Pushes one table's rows for one household. Returns the number of rows
 * actually written (excludes stale LWW losers and ledger ids already held)
 * and the highest `sync_seq` among them.
 *
 * The `household_id = <caller>` predicate in the mutable branch's `setWhere`
 * is load-bearing (W9-DESIGN §D5): without it, a client that supplies another
 * household's row id would overwrite that row on conflict. Ledger rows can
 * never be overwritten at all, by any household, since `onConflictDoNothing`
 * has no update path to guard.
 */
async function pushTable(
  db: any,
  spec: SyncTableSpec,
  householdId: string,
  dtoRows: unknown[] | undefined,
): Promise<{ count: number; maxSeq: number }> {
  if (!dtoRows || dtoRows.length === 0) {
    return { count: 0, maxSeq: 0 };
  }

  const values = dtoRows.map((row) => spec.fromDto(row, householdId));

  const written =
    spec.kind === "ledger"
      ? await db.insert(spec.table).values(values).onConflictDoNothing().returning({ syncSeq: spec.table.syncSeq })
      : await db
          .insert(spec.table)
          .values(values)
          .onConflictDoUpdate({
            target: spec.table.id,
            set: excludedSetClause(spec.table),
            setWhere: and(eq(spec.table.householdId, householdId), sql`excluded.updated_at > ${spec.table.updatedAt}`),
          })
          .returning({ syncSeq: spec.table.syncSeq });

  const maxSeq = written.reduce((max: number, row: { syncSeq: number }) => Math.max(max, Number(row.syncSeq)), 0);
  return { count: written.length, maxSeq };
}

/**
 * Pulls one table's rows for one household, strictly after `cursor`, newest
 * `sync_seq` last, capped at `PULL_LIMIT`. The `household_id = <caller>`
 * predicate here is the only thing standing between a member of one household
 * and another household's rows.
 */
async function pullTable(
  db: any,
  spec: SyncTableSpec,
  householdId: string,
  cursor: number,
): Promise<{ rows: any[]; truncated: boolean; maxSeq: number }> {
  const rows = await db
    .select()
    .from(spec.table)
    .where(and(eq(spec.table.householdId, householdId), gt(spec.table.syncSeq, cursor)))
    .orderBy(asc(spec.table.syncSeq))
    .limit(PULL_LIMIT);

  const maxSeq = rows.reduce((max: number, row: any) => Math.max(max, Number(row.syncSeq)), 0);
  return { rows, truncated: rows.length >= PULL_LIMIT, maxSeq };
}

export default fastifyPlugin(async (fastify) => {
  // MUST be awaited — see household/index.ts for why a bare register() leaves
  // `fastify.authenticate` undefined at route-definition time.
  await fastify.register(authenticatePlugin);

  fastify.post<{ Body: SyncPushBody }>(
    "/sync/push",
    { preHandler: fastify.authenticate },
    async (request, reply): Promise<SyncPushResult | undefined> => {
      const householdId = await requireHousehold(fastify, request, reply);
      if (!householdId) return;

      const changes = request.body?.changes ?? {};

      let accepted = 0;
      let cursorSeq = 0;

      // One transaction for the whole push: either every table's batch lands
      // or none does (W9-DESIGN §D5).
      await fastify.db.transaction(async (tx: any) => {
        for (const spec of SYNC_TABLES) {
          const { count, maxSeq } = await pushTable(tx, spec, householdId, changes[spec.key]);
          accepted += count;
          cursorSeq = Math.max(cursorSeq, maxSeq);
        }
      });

      return { accepted, cursor: String(cursorSeq) };
    },
  );

  fastify.get<{ Querystring: { cursor?: string } }>(
    "/sync/pull",
    { preHandler: fastify.authenticate },
    async (request, reply): Promise<SyncPullResult | undefined> => {
      const householdId = await requireHousehold(fastify, request, reply);
      if (!householdId) return;

      const parsedCursor = Number(request.query.cursor);
      const cursor = Number.isFinite(parsedCursor) ? parsedCursor : 0;

      const changes: SyncPayload = {};
      let anyRows = false;
      let anyTruncated = false;
      let overallMax = cursor;
      let truncatedMin = Number.POSITIVE_INFINITY;

      for (const spec of SYNC_TABLES) {
        const { rows, truncated, maxSeq } = await pullTable(fastify.db, spec, householdId, cursor);
        if (rows.length === 0) continue;

        anyRows = true;
        (changes as Record<string, unknown[]>)[spec.key] = rows.map((row) => spec.toDto(row));
        overallMax = Math.max(overallMax, maxSeq);

        if (truncated) {
          anyTruncated = true;
          truncatedMin = Math.min(truncatedMin, maxSeq);
        }
      }

      // W9-DESIGN §D5 cursor rule: when something truncated, advance only to
      // the smallest truncated table's max — an untruncated table may then
      // re-deliver rows above that point next page, which is harmless because
      // apply is idempotent, and no row can be skipped. Otherwise advance to
      // the max actually returned, or leave the cursor untouched if nothing was.
      const nextCursor = anyTruncated ? truncatedMin : anyRows ? overallMax : cursor;

      return { changes, cursor: String(nextCursor), hasMore: anyTruncated };
    },
  );
});
