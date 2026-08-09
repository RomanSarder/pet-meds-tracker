import { FastifyReply } from "fastify";
import fastifyPlugin from "fastify-plugin";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import {
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
  SelfDto,
  SetDisplayNameBody,
} from "@pet-tracker/shared";
import { households, joinCodes, users } from "../db/schema";
import authenticatePlugin from "../auth/authenticate-plugin";
import { evaluateJoinCode, generateJoinCode, JOIN_CODE_TTL_MS } from "./joinCode";

type UserRow = typeof users.$inferSelect;
type HouseholdRow = typeof households.$inferSelect;
type JoinCodeRow = typeof joinCodes.$inferSelect;

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
function toMemberDto(user: UserRow): MemberDto {
  return {
    id: user.id,
    householdId: user.householdId!,
    displayName: user.displayName ?? "",
    tint: user.tint as 1 | 2 | 3 | 4,
    joinedAt: (user.joinedAt ?? user.createdAt ?? new Date()).toISOString(),
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
            name: { type: "string" },
            displayName: { type: "string" },
          },
        },
      },
    },
    async (request): Promise<HouseholdStateDto> => {
      const { name, displayName } = request.body ?? {};

      const [household] = await fastify.db
        .insert(households)
        .values({ name: name?.trim() ? name.trim() : null })
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

      // Issuing a code revokes every other live code first, so at most one is ever live.
      await fastify.db
        .update(joinCodes)
        .set({ revokedAt: now })
        .where(and(eq(joinCodes.householdId, householdId), isNull(joinCodes.usedBy), isNull(joinCodes.revokedAt)));

      let inserted: JoinCodeRow | undefined;
      for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
        [inserted] = await fastify.db
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
