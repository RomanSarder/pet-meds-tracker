import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fastifyPlugin from "fastify-plugin";
import { and, asc, eq, getTableColumns, gt, ne, sql, SQL } from "drizzle-orm";
import { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import {
  CourseDto,
  CourseEventDto,
  DoseEventDto,
  MedicationDto,
  MemberDto,
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
import { toMemberDto } from "../household/index";

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
    // Optional on the wire (absent means "never over") even though the
    // column is a plain NOT NULL boolean — omit rather than send `false`.
    ...(row.overMax ? { overMax: true } : {}),
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
    overMax: dto.overMax === true,
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

// Exported so tests can assert against it directly, e.g. sync/index.test.ts's
// TABLE_SPECS-vs-SYNC_TABLES coverage check. Purely additive visibility change
// — does not alter runtime behaviour.
export const SYNC_TABLES: readonly SyncTableSpec[] = [
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
 *
 * Also returns the caller's own `aliasIds`: `/sync/pull` needs it (see
 * `selfAliasIds` on `SyncPullResult`) and this is the one place both sync
 * routes already fetch the caller's own row, so exposing it here costs no
 * extra query. `/sync/push` simply ignores the field.
 */
async function requireHousehold(
  fastify: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<{ householdId: string; aliasIds: string[] } | null> {
  const [user] = await fastify.db.select().from(users).where(eq(users.id, request.userId));
  if (!user || !user.householdId) {
    reply.notFound();
    return null;
  }
  return { householdId: user.householdId, aliasIds: user.aliasIds ?? [] };
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
 *
 * `actorId` on a ledger row is trusted verbatim ONLY when it names a member
 * of the CALLER's OWN household — `allowedActorIds` (built once per push
 * in the route handler below, never per row) is that household's every
 * member canonical `users.id` UNION every one of their disclosed
 * `aliasIds`. The user's own decision: household members are mutually
 * trusted with attribution (SPEC §5, "no permissions"), so one member
 * pushing a row that legitimately names another member — e.g. a
 * merge-mode `importHousehold` bringing in someone else's own dose/course/
 * stock history, still carrying THEIR `actorId` — must not get silently
 * reattributed to the pusher; the frontend used to solve this by simply
 * never pushing such a row at all, which meant it was stranded forever the
 * moment its true author's own device never came back online (worse than
 * mis-attribution, for a medication tracker: a dose nobody can see was
 * given invites a duplicate). `callerId` is the fallback for anything
 * else — an id belonging to nobody, or to a member of a DIFFERENT
 * household entirely — which is what keeps this from reopening the
 * cross-household attribution-spoofing hole the earlier, unconditional
 * version of this stamping closed. Mutable tables (pets/medications/
 * courses) have no `actorId` column and are untouched by this.
 */
async function pushTable(
  db: any,
  spec: SyncTableSpec,
  householdId: string,
  callerId: string,
  allowedActorIds: ReadonlySet<string>,
  dtoRows: unknown[] | undefined,
): Promise<{ count: number; maxSeq: number }> {
  if (!dtoRows || dtoRows.length === 0) {
    return { count: 0, maxSeq: 0 };
  }

  const values = dtoRows.map((row) => spec.fromDto(row, householdId));
  if (spec.kind === "ledger") {
    for (const value of values) {
      const actorId = (value as { actorId: string }).actorId;
      (value as { actorId: string }).actorId = allowedActorIds.has(actorId) ? actorId : callerId;
    }
  }

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

/**
 * The caller's household roster (every OTHER member — never the caller's own
 * row), attached to every `/sync/pull` response under `changes.users`.
 *
 * Deliberately NOT a `SYNC_TABLES` entry: `users` is the auth identity table
 * (unique `email`, no `updated_at`/`sync_seq` column, sessions and magic-link
 * tokens hang off its `id`), so it cannot safely take the generic mutable
 * table's client-writable LWW upsert the way pets/medications/etc. do — a
 * client-supplied row on THIS table could otherwise collide with another
 * account's identity. Accordingly this is PULL-ONLY: `/sync/push` never reads
 * a `users` key from the request body at all (see `pushTable`'s callers
 * below, which only ever iterate `SYNC_TABLES`).
 *
 * Also deliberately NOT cursor-gated like the six tables: household rosters
 * are small (a handful of people), so every pull just re-sends the CURRENT
 * full list rather than tracking a `sync_seq` watermark and soft-delete
 * tombstone for a table this size — the simpler, safer choice here over
 * adding replication columns to the auth table. `household_id` is taken from
 * `requireHousehold`'s session-derived value, never from client input, so
 * this can never return another household's members (W9-DESIGN §D5's rule,
 * same as every other table in this file).
 */
async function pullRoster(db: any, householdId: string, callerUserId: string): Promise<MemberDto[]> {
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.householdId, householdId), ne(users.id, callerUserId)));
  return rows.map(toMemberDto);
}

/**
 * Every actor id `/sync/push` will trust verbatim on a ledger row: the
 * caller's OWN household's members, by canonical `users.id`, UNION every
 * one of their disclosed `aliasIds` (see `users.aliasIds`'s schema comment
 * — a member's pre-fix local id, which their own already-pushed history may
 * still be stamped with). `householdId` MUST be the session-derived value
 * `requireHousehold` already resolved — never anything from the request
 * body — or a client could simply claim membership in a household it
 * isn't in and launder attribution to one of ITS members instead. One
 * query for the whole push, not one per row: `pushTable` is called once
 * per table (six times, at most), and this set is built once up front and
 * passed to all of them.
 */
async function allowedActorIdsForHousehold(db: any, householdId: string): Promise<Set<string>> {
  const rows = await db
    .select({ id: users.id, aliasIds: users.aliasIds })
    .from(users)
    .where(eq(users.householdId, householdId));
  const allowed = new Set<string>();
  for (const row of rows as Array<{ id: string; aliasIds: string[] | null }>) {
    allowed.add(row.id);
    for (const alias of row.aliasIds ?? []) {
      allowed.add(alias);
    }
  }
  return allowed;
}

export default fastifyPlugin(async (fastify) => {
  // MUST be awaited — see household/index.ts for why a bare register() leaves
  // `fastify.authenticate` undefined at route-definition time.
  await fastify.register(authenticatePlugin);

  fastify.post<{ Body: SyncPushBody }>(
    "/sync/push",
    { preHandler: fastify.authenticate },
    async (request, reply): Promise<SyncPushResult | undefined> => {
      const resolved = await requireHousehold(fastify, request, reply);
      if (!resolved) return;
      const { householdId } = resolved;

      const changes = request.body?.changes ?? {};
      // One query for the whole request (not per row, not per table) —
      // see `allowedActorIdsForHousehold`'s doc comment.
      const allowedActorIds = await allowedActorIdsForHousehold(fastify.db, householdId);

      let accepted = 0;
      let cursorSeq = 0;

      // One transaction for the whole push: either every table's batch lands
      // or none does (W9-DESIGN §D5).
      await fastify.db.transaction(async (tx: any) => {
        for (const spec of SYNC_TABLES) {
          const { count, maxSeq } = await pushTable(
            tx,
            spec,
            householdId,
            request.userId,
            allowedActorIds,
            changes[spec.key],
          );
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
      const resolved = await requireHousehold(fastify, request, reply);
      if (!resolved) return;
      const { householdId, aliasIds: callerAliasIds } = resolved;

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

      // Runs after the six-table loop and does not affect `nextCursor`/
      // `hasMore` at all — see `pullRoster`'s comment for why this is a
      // separate, uncursored side channel rather than a seventh SYNC_TABLES
      // entry.
      const roster = await pullRoster(fastify.db, householdId, request.userId);
      if (roster.length > 0) {
        changes.users = roster;
      }

      return {
        changes,
        cursor: String(nextCursor),
        hasMore: anyTruncated,
        // See `SyncPullResult.selfAliasIds`'s doc comment: `pullRoster`
        // excludes the caller's own row from `changes.users` by design, so
        // this is the only way a SECOND device of the same account ever
        // learns its own account's disclosed aliases without a Household
        // screen visit.
        ...(callerAliasIds.length > 0 ? { selfAliasIds: callerAliasIds } : {}),
      };
    },
  );
});
