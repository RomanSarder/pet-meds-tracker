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
