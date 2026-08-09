import { relations } from "drizzle-orm";
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { households } from "./households";
import { users } from "./users";

export const joinCodes = pgTable("join_codes", {
  id: uuid().primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id),
  code: text().unique().notNull(),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedBy: uuid("used_by").references(() => users.id),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const joinCodesRelations = relations(joinCodes, ({ one }) => {
  return {
    household: one(households, {
      fields: [joinCodes.householdId],
      references: [households.id],
    }),
    creator: one(users, {
      fields: [joinCodes.createdBy],
      references: [users.id],
    }),
    user: one(users, {
      fields: [joinCodes.usedBy],
      references: [users.id],
    }),
  };
});
