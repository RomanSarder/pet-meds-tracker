import { relations, sql } from "drizzle-orm";
import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { households } from "./households";
import { users } from "./users";

export const joinCodes = pgTable(
  "join_codes",
  {
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
  },
  (table) => [
    // SPEC §5: "Only one code is live per household at a time." The issue route
    // revokes-then-inserts inside a transaction, but at READ COMMITTED two
    // concurrent issuers can each see nothing to revoke and both insert. This
    // partial unique index is what actually makes two live codes unrepresentable
    // — the second inserter fails instead of quietly creating a rival code that
    // stays redeemable after a newer one was issued. Do not drop it and rely on
    // the transaction alone.
    uniqueIndex("join_codes_one_live_per_household")
      .on(table.householdId)
      .where(sql`${table.usedBy} is null and ${table.revokedAt} is null`),
  ],
);

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
