import { relations } from "drizzle-orm";
import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sessions } from "./sessions";
import { magicLinkTokens } from "./magic-link-tokens";
import { households } from "./households";

export const users = pgTable("users", {
  id: uuid().primaryKey().defaultRandom(),
  email: text().unique().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  // Nullable: a user who has signed in but not yet created or joined a household
  // (SPEC §6.9 first run). No role column, no owner column — SPEC §5 "Permissions: none".
  householdId: uuid("household_id").references(() => households.id),
  displayName: text("display_name"),
  tint: integer().notNull().default(1),
  joinedAt: timestamp("joined_at", { withTimezone: true }),
  // Reconciliation for the pre-fix identity bug: a device used to mint its
  // own random "self" user id locally, never reconciled with this row's
  // canonical id, and stamped `actorId` on ledger rows with it before the
  // mismatch was ever pushed anywhere. `POST /household/me/aliases` lets an
  // account disclose those stale ids as its own (self-only — the route
  // never writes any other account's row), and `toMemberDto`/`toSelfDto`
  // carry them to every device so `displayNameFor` resolves the old id to
  // this same member. Never used to reject or de-dup a *new* actorId — the
  // ledger rows themselves are append-only and are never rewritten.
  aliasIds: uuid("alias_ids").array().notNull().default([]),
});

export const usersRelations = relations(users, ({ one, many }) => {
  return {
    session: one(sessions),
    magicLinkTokens: many(magicLinkTokens),
    household: one(households, {
      fields: [users.householdId],
      references: [households.id],
    }),
  };
});
