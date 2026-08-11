import { FastifyReply } from "fastify";
import fastifyPlugin from "fastify-plugin";
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import {
  AddSelfAliasIdsBody,
  ConfirmationRequiredError,
  CreateHouseholdBody,
  HouseholdStateDto,
  JoinCodeDto,
  JoinCodeRejectedError,
  JoinCodeRejection,
  JoinPreviewDto,
  LeaveHouseholdBody,
  LeaveHouseholdResult,
  MemberDto,
  RedeemJoinCodeBody,
  SelfAliasesDto,
  SelfDto,
  SetDisplayNameBody,
} from "@pet-tracker/shared";
import { households, joinCodes, users } from "../db/schema";
import authenticatePlugin from "../auth/authenticate-plugin";
import { evaluateJoinCode, generateJoinCode, JOIN_CODE_TTL_MS } from "./joinCode";

type UserRow = typeof users.$inferSelect;
type HouseholdRow = typeof households.$inferSelect;
type JoinCodeRow = typeof joinCodes.$inferSelect;

// A4: see `POST /household/me/aliases`'s eviction-rule comment.
const ALIAS_ID_CAP = 50;

/** A `uuid[]` literal built from bound parameters — never raw string interpolation. */
function uuidArrayLiteral(ids: string[]) {
  return sql`ARRAY[${sql.join(ids.map((id) => sql`${id}::uuid`), sql.raw(", "))}]::uuid[]`;
}

function toHouseholdDto(row: HouseholdRow) {
  return {
    id: row.id,
    name: row.name,
    // Column has a DB default (now()) and is always populated on insert.
    createdAt: (row.createdAt ?? new Date()).toISOString(),
  };
}

// SPEC §5: "If a user is somehow persisted without a name, render 'Someone'" — that
// substitution belongs to the frontend's displayNameFor helper, so the wire DTO just
// carries "" for an unset name rather than inventing a placeholder server-side.
//
// Exported so `sync/index.ts` can reuse it for the roster it now attaches to
// every `/sync/pull` response (see that file) — one row-to-DTO mapping for
// the `users` table, not two that could drift apart.
export function toMemberDto(user: UserRow): MemberDto {
  return {
    id: user.id,
    householdId: user.householdId!,
    displayName: user.displayName ?? "",
    tint: user.tint as 1 | 2 | 3 | 4,
    joinedAt: (user.joinedAt ?? user.createdAt ?? new Date()).toISOString(),
    aliasIds: user.aliasIds ?? [],
  };
}

function toSelfDto(user: UserRow): SelfDto {
  return {
    id: user.id,
    displayName: user.displayName ?? "",
    tint: user.tint as 1 | 2 | 3 | 4,
    joinedAt: (user.joinedAt ?? user.createdAt ?? new Date()).toISOString(),
    householdId: user.householdId,
    email: user.email,
    aliasIds: user.aliasIds ?? [],
  };
}

function toJoinCodeDto(row: JoinCodeRow): JoinCodeDto {
  return {
    id: row.id,
    householdId: row.householdId,
    code: row.code,
    createdBy: row.createdBy,
    expiresAt: row.expiresAt.toISOString(),
    usedBy: row.usedBy,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    createdAt: (row.createdAt ?? new Date()).toISOString(),
  };
}

// Backend has no Pet model yet — pets are local-only until slice 9 wires up sync
// (CONTRACT-W8 §0). The preview therefore always shows an empty pet list; the shape
// is otherwise complete so slice 9 only has to fill this array in.
function toJoinPreview(household: HouseholdRow, memberCount: number): JoinPreviewDto {
  return {
    householdId: household.id,
    householdName: household.name,
    memberCount,
    pets: [],
  };
}

// SPEC §2: tint is "assigned on join" from the same 1-4 palette as pets.
function nextTint(memberCount: number): 1 | 2 | 3 | 4 {
  return ((memberCount % 4) + 1) as 1 | 2 | 3 | 4;
}

function rejectionMessage(reason: JoinCodeRejection): string {
  switch (reason) {
    case "not_found":
      return "That code was not found.";
    case "already_used":
      return "That code has already been used.";
    case "expired":
      return "That code has expired.";
    case "revoked":
      return "That code is no longer valid — a newer one was issued.";
    case "already_in_household":
      return "You already belong to a household.";
  }
}

function sendJoinCodeRejection(reply: FastifyReply, reason: JoinCodeRejection) {
  const status = reason === "not_found" ? 404 : 409;
  const body: JoinCodeRejectedError = {
    error: "join_code_rejected",
    reason,
    message: rejectionMessage(reason),
  };
  return reply.code(status).send(body);
}

export default fastifyPlugin(async (fastify) => {
  // MUST be awaited. Every route below reads `fastify.authenticate` at route-definition
  // time, and a bare `register()` only queues the plugin — the decorator would still be
  // undefined, silently giving each route NO preHandler and an empty `request.userId`.
  // `auth/index.ts` gets away with a bare register only because its routes are nested one
  // more `register()` deep, which defers their evaluation.
  await fastify.register(authenticatePlugin);

  fastify.get("/household", { preHandler: fastify.authenticate }, async (request, reply): Promise<HouseholdStateDto> => {
    const [user] = await fastify.db.select().from(users).where(eq(users.id, request.userId));
    if (!user || !user.householdId) {
      return reply.notFound();
    }

    const [household] = await fastify.db.select().from(households).where(eq(households.id, user.householdId));
    if (!household) {
      return reply.notFound();
    }

    const members = await fastify.db.select().from(users).where(eq(users.householdId, household.id));

    return {
      household: toHouseholdDto(household),
      members: members.map(toMemberDto),
      self: toSelfDto(user),
    };
  });

  fastify.post<{ Body: CreateHouseholdBody }>(
    "/household",
    {
      preHandler: fastify.authenticate,
      schema: {
        body: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            name: { type: "string" },
            displayName: { type: "string" },
          },
        },
      },
    },
    async (request, reply): Promise<HouseholdStateDto> => {
      const { id, name, displayName } = request.body ?? {};

      const [caller] = await fastify.db.select().from(users).where(eq(users.id, request.userId));
      if (!caller) {
        return reply.unauthorized();
      }

      // SPEC §5: "a user belongs to exactly one household at a time." A caller who
      // already has one (e.g. re-submitting the first-run screen, or revisiting
      // /welcome after already provisioning) is not a new household — this is the
      // idempotent no-op twin of /household/join's "already_in_household" refusal,
      // returning their existing state unchanged rather than erroring or minting a
      // second household.
      if (caller.householdId) {
        const [existingHousehold] = await fastify.db
          .select()
          .from(households)
          .where(eq(households.id, caller.householdId));
        const members = await fastify.db.select().from(users).where(eq(users.householdId, caller.householdId));
        return {
          household: toHouseholdDto(existingHousehold),
          members: members.map(toMemberDto),
          self: toSelfDto(caller),
        };
      }

      // SPEC §9: `id`, when supplied, is the household id the client already
      // minted locally (W5's IndexedDB stub) — using it here, instead of the
      // column's `defaultRandom()`, is what keeps the local and server rows the
      // same id rather than requiring a mapping between two ids.
      const [household] = await fastify.db
        .insert(households)
        .values({ ...(id ? { id } : {}), name: name?.trim() ? name.trim() : null })
        .returning();

      const updateValues: Partial<typeof users.$inferInsert> = {
        householdId: household.id,
        tint: nextTint(0),
        joinedAt: new Date(),
      };
      if (displayName && displayName.trim()) {
        updateValues.displayName = displayName.trim();
      }

      const [user] = await fastify.db.update(users).set(updateValues).where(eq(users.id, request.userId)).returning();

      return {
        household: toHouseholdDto(household),
        members: [toMemberDto(user)],
        self: toSelfDto(user),
      };
    },
  );

  fastify.patch<{ Body: SetDisplayNameBody }>(
    "/household/me",
    {
      preHandler: fastify.authenticate,
      schema: {
        body: {
          type: "object",
          required: ["displayName"],
          properties: {
            displayName: { type: "string" },
          },
        },
      },
    },
    async (request, reply): Promise<SelfDto> => {
      const trimmed = request.body.displayName.trim();
      if (trimmed.length < 1 || trimmed.length > 24) {
        return reply.badRequest("Display name must be 1-24 characters.");
      }

      const [user] = await fastify.db
        .update(users)
        .set({ displayName: trimmed })
        .where(eq(users.id, request.userId))
        .returning();

      if (!user) {
        return reply.unauthorized();
      }

      return toSelfDto(user);
    },
  );

  // Reconciliation for the pre-fix identity bug (see `users.aliasIds`'s
  // schema comment): a device's local "self" row used to get a
  // locally-minted id that was never reconciled with this account's
  // canonical `users.id`, and any dose/course/stock event it logged before
  // the mismatch was caught carries that stale id as its `actorId` — some
  // of them already pushed and sitting in ledger tables that are, by
  // design, never rewritten (`SYNC_TABLES`'s ledger kind: insert-if-absent,
  // no update path at all). Rather than rewrite that history, the CLIENT
  // (which is the only party that ever knew its own stale id — it was
  // never disclosed to the server before this route existed) discloses it
  // here, and `toMemberDto`/`toSelfDto` carry the resulting `aliasIds` to
  // every device via the existing roster pull, so `displayNameFor` can
  // match an old actorId to this same member without touching a single
  // historical row.
  //
  // Deliberately self-only and NOT a `/sync/push`-style bulk write: this
  // updates exactly `request.userId`'s own row, the same shape of
  // self-mutation `PATCH /household/me` above already allows, and never
  // reads a target-user id from the body. That is what keeps this
  // different from the roster's deliberately PULL-ONLY `users` write path
  // (W9-DESIGN §D5) — this never lets a caller name any row but their own.
  //
  // `ids` that already belong to a *real* account (any existing
  // `users.id`, self included) are silently dropped rather than merged: an
  // alias id must stay a dead, unclaimed value forever, or a member could
  // alias themselves to another live account's id and hijack that
  // account's FUTURE events (any device that later re-mirrors the roster
  // would then resolve the victim's new dose logs to the attacker's name).
  // Idempotent: re-submitting the same ids changes nothing, since the
  // dedup and the "already alive" filter apply identically every time.
  //
  // USER DECISION (authoritative, do not "fix" without raising it again):
  // this collision check is the ONLY guard. There is deliberately no
  // uniqueness constraint or normalized alias table preventing two DIFFERENT
  // accounts from independently claiming the SAME dead, never-claimed id as
  // their own — household members are trusted with each other's
  // attribution, not modelled as adversaries of one another (SPEC §5: "no
  // permissions", any member can already rename or remove any other with no
  // check at all). A member deliberately claiming a stale id they somehow
  // learned belonged to another member's history is accepted as out of
  // scope. What this guard DOES prevent is an account reassigning a REAL,
  // currently-live account's identity to itself — the only case that is an
  // accident-proof, not merely a trust-model, concern.
  fastify.post<{ Body: AddSelfAliasIdsBody }>(
    "/household/me/aliases",
    {
      preHandler: fastify.authenticate,
      schema: {
        body: {
          type: "object",
          required: ["ids"],
          properties: {
            ids: { type: "array", items: { type: "string", format: "uuid" }, maxItems: 20 },
          },
        },
      },
    },
    async (request, reply): Promise<SelfAliasesDto> => {
      const [caller] = await fastify.db.select().from(users).where(eq(users.id, request.userId));
      if (!caller) {
        return reply.unauthorized();
      }

      const candidates = Array.from(new Set(request.body.ids.filter((id) => id !== caller.id)));
      if (candidates.length === 0) {
        return { aliasIds: caller.aliasIds ?? [] };
      }

      const collisions = await fastify.db.select({ id: users.id }).from(users).where(inArray(users.id, candidates));
      const claimed = new Set(collisions.map((row) => row.id));
      const safeCandidates = candidates.filter((id) => !claimed.has(id));
      if (safeCandidates.length === 0) {
        return { aliasIds: caller.aliasIds ?? [] };
      }

      // Atomic, capped append. The new value is computed ENTIRELY from the
      // column's live value inside one UPDATE statement — never from
      // `caller.aliasIds` read above — because Postgres locks and evaluates
      // a single UPDATE's SET expression against the row's current value:
      // two concurrent reconciliations from two devices of the SAME account
      // (the reported failure — device 1 adds X, device 2 adds Y, both read
      // an empty array first) now serialize correctly instead of the second
      // write silently clobbering the first's addition. `WITH ORDINALITY`
      // dedups while preserving first-seen order (a plain `DISTINCT` does
      // not guarantee order), so this is also naturally idempotent:
      // re-submitting an id already present changes nothing.
      //
      // Cap + eviction rule (A4): `aliasIds` can otherwise grow without
      // bound — `currentActorId()` mints a fresh throwaway local id on every
      // fresh install, every `resetLocalHousehold`, and every account
      // switch, and each one gets disclosed here. Capped at
      // `ALIAS_ID_CAP`; once full, the OLDEST ids (by first-disclosed order)
      // are evicted to make room for new ones — chosen over refusing new
      // additions because a device that just reconciled needs ITS current
      // stale id resolvable, and eviction only ever discards the ids least
      // likely to still be needed. In practice a real account accumulates a
      // handful of these, not dozens; hitting the cap is not expected
      // outside of pathological reset loops.
      const merged = sql<string[]>`(
        SELECT ARRAY(
          SELECT x FROM (
            SELECT x, MIN(ord) AS first_ord
            FROM unnest(${users.aliasIds} || ${uuidArrayLiteral(safeCandidates)}) WITH ORDINALITY AS t(x, ord)
            GROUP BY x
            ORDER BY first_ord DESC
            LIMIT ${ALIAS_ID_CAP}
          ) capped
          ORDER BY first_ord ASC
        )
      )`;

      const [updated] = await fastify.db
        .update(users)
        .set({ aliasIds: merged })
        .where(eq(users.id, request.userId))
        .returning();

      return { aliasIds: updated?.aliasIds ?? caller.aliasIds ?? [] };
    },
  );

  fastify.get("/household/members", { preHandler: fastify.authenticate }, async (request, reply): Promise<MemberDto[]> => {
    const [user] = await fastify.db.select().from(users).where(eq(users.id, request.userId));
    if (!user || !user.householdId) {
      return reply.notFound();
    }

    const members = await fastify.db.select().from(users).where(eq(users.householdId, user.householdId));
    return members.map(toMemberDto);
  });

  fastify.post(
    "/household/codes",
    { preHandler: fastify.authenticate },
    async (request, reply): Promise<JoinCodeDto> => {
      const [user] = await fastify.db.select().from(users).where(eq(users.id, request.userId));
      if (!user || !user.householdId) {
        return reply.notFound();
      }
      if (!user.displayName || !user.displayName.trim()) {
        return reply.badRequest("Set your display name before inviting anyone.");
      }

      const now = new Date();
      const householdId = user.householdId;

      // SPEC §5: "Only one code is live per household at a time; issuing a new one
      // revokes the previous." Revoke and insert must land together — a bare
      // sequence of two statements lets a concurrent issuer interleave between
      // them, so both see nothing to revoke and both insert a live code. The
      // partial unique index `join_codes_one_live_per_household` is the backstop
      // that makes the losing side fail rather than create a second live code.
      const inserted = await fastify.db.transaction(async (tx) => {
        await tx
          .update(joinCodes)
          .set({ revokedAt: now })
          .where(
            and(eq(joinCodes.householdId, householdId), isNull(joinCodes.usedBy), isNull(joinCodes.revokedAt)),
          );

        // Retries cover a collision on the globally unique `code` column only —
        // six characters from a 32-glyph alphabet is ~1e9 codes, so this
        // effectively never loops, but a duplicate must not surface as a 500.
        let row: JoinCodeRow | undefined;
        for (let attempt = 0; attempt < 5 && !row; attempt++) {
          [row] = await tx
            .insert(joinCodes)
            .values({
              householdId,
              code: generateJoinCode(),
              createdBy: user.id,
              expiresAt: new Date(now.getTime() + JOIN_CODE_TTL_MS),
            })
            .onConflictDoNothing()
            .returning();
        }
        return row;
      });

      if (!inserted) {
        throw fastify.httpErrors.internalServerError();
      }

      return toJoinCodeDto(inserted);
    },
  );

  fastify.get(
    "/household/codes/live",
    { preHandler: fastify.authenticate },
    async (request, reply): Promise<JoinCodeDto | null> => {
      const [user] = await fastify.db.select().from(users).where(eq(users.id, request.userId));
      if (!user || !user.householdId) {
        return reply.notFound();
      }

      const now = new Date();
      const [live] = await fastify.db
        .select()
        .from(joinCodes)
        .where(
          and(
            eq(joinCodes.householdId, user.householdId),
            isNull(joinCodes.usedBy),
            isNull(joinCodes.revokedAt),
            gt(joinCodes.expiresAt, now),
          ),
        )
        .orderBy(desc(joinCodes.createdAt))
        .limit(1);

      return live ? toJoinCodeDto(live) : null;
    },
  );

  fastify.get<{ Params: { code: string } }>(
    "/household/join/:code",
    { preHandler: fastify.authenticate },
    async (request, reply): Promise<JoinPreviewDto> => {
      const code = request.params.code.toUpperCase();
      const [row] = await fastify.db.select().from(joinCodes).where(eq(joinCodes.code, code));

      const verdict = evaluateJoinCode(row ?? null, new Date());
      if (!verdict.ok) {
        return sendJoinCodeRejection(reply, verdict.reason);
      }

      const [household] = await fastify.db.select().from(households).where(eq(households.id, row!.householdId));
      if (!household) {
        return sendJoinCodeRejection(reply, "not_found");
      }

      const members = await fastify.db.select().from(users).where(eq(users.householdId, household.id));
      return toJoinPreview(household, members.length);
    },
  );

  fastify.post<{ Body: RedeemJoinCodeBody }>(
    "/household/join",
    {
      preHandler: fastify.authenticate,
      schema: {
        body: {
          type: "object",
          required: ["code"],
          properties: {
            code: { type: "string" },
            displayName: { type: "string" },
          },
        },
      },
    },
    async (request, reply): Promise<HouseholdStateDto> => {
      const [caller] = await fastify.db.select().from(users).where(eq(users.id, request.userId));
      if (!caller) {
        return reply.unauthorized();
      }
      // SPEC §5: "a user belongs to exactly one household at a time"; switching
      // households is out of scope for v1 — leave first, then join elsewhere.
      if (caller.householdId) {
        return sendJoinCodeRejection(reply, "already_in_household");
      }

      const code = request.body.code.toUpperCase();
      const now = new Date();

      // Atomic conditional update — the sole gate on single-use redemption, in the
      // same spirit as the delete-and-return in auth/index.ts. An empty return means
      // refused; only then do we read the row again, purely to explain why.
      const [claimed] = await fastify.db
        .update(joinCodes)
        .set({ usedBy: caller.id })
        .where(
          and(
            eq(joinCodes.code, code),
            isNull(joinCodes.usedBy),
            isNull(joinCodes.revokedAt),
            gt(joinCodes.expiresAt, now),
          ),
        )
        .returning();

      if (!claimed) {
        const [row] = await fastify.db.select().from(joinCodes).where(eq(joinCodes.code, code));
        const verdict = evaluateJoinCode(row ?? null, now);
        return sendJoinCodeRejection(reply, verdict.ok ? "not_found" : verdict.reason);
      }

      const members = await fastify.db.select().from(users).where(eq(users.householdId, claimed.householdId));

      const updateValues: Partial<typeof users.$inferInsert> = {
        householdId: claimed.householdId,
        tint: nextTint(members.length),
        joinedAt: now,
      };
      const displayName = request.body.displayName?.trim();
      if (displayName) {
        updateValues.displayName = displayName;
      }

      const [user] = await fastify.db.update(users).set(updateValues).where(eq(users.id, caller.id)).returning();

      const [household] = await fastify.db.select().from(households).where(eq(households.id, claimed.householdId));
      const updatedMembers = await fastify.db.select().from(users).where(eq(users.householdId, claimed.householdId));

      return {
        household: toHouseholdDto(household!),
        members: updatedMembers.map(toMemberDto),
        self: toSelfDto(user!),
      };
    },
  );

  fastify.delete<{ Params: { userId: string } }>(
    "/household/members/:userId",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const [caller] = await fastify.db.select().from(users).where(eq(users.id, request.userId));
      if (!caller || !caller.householdId) {
        return reply.notFound();
      }

      const [target] = await fastify.db.select().from(users).where(eq(users.id, request.params.userId));
      if (!target || target.householdId !== caller.householdId) {
        return reply.notFound();
      }

      // Clears membership only — never touches displayName, so a removed member's
      // history keeps rendering their name (SPEC §5: "history is never rewritten").
      await fastify.db.update(users).set({ householdId: null }).where(eq(users.id, target.id));

      return {};
    },
  );

  fastify.post<{ Body: LeaveHouseholdBody }>(
    "/household/leave",
    {
      preHandler: fastify.authenticate,
      schema: {
        body: {
          type: "object",
          properties: {
            confirmDelete: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply): Promise<LeaveHouseholdResult> => {
      const [caller] = await fastify.db.select().from(users).where(eq(users.id, request.userId));
      if (!caller || !caller.householdId) {
        return reply.notFound();
      }

      const householdId = caller.householdId;
      const members = await fastify.db.select().from(users).where(eq(users.householdId, householdId));
      const isLastMember = members.length <= 1;

      if (isLastMember) {
        if (!request.body?.confirmDelete) {
          const body: ConfirmationRequiredError = {
            error: "confirmation_required",
            message: "Leaving as the last member deletes the household. Confirm to continue.",
          };
          return reply.code(409).send(body);
        }

        // Nothing is auto-deleted elsewhere (SPEC §1) — this explicit, confirmed
        // deletion is the one exception, and only for the household record itself.
        await fastify.db.delete(joinCodes).where(eq(joinCodes.householdId, householdId));
        await fastify.db.update(users).set({ householdId: null }).where(eq(users.id, caller.id));
        await fastify.db.delete(households).where(eq(households.id, householdId));

        return { householdDeleted: true };
      }

      await fastify.db.update(users).set({ householdId: null }).where(eq(users.id, caller.id));
      return { householdDeleted: false };
    },
  );
});
