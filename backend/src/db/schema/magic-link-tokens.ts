import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";
import { relations } from "drizzle-orm";

export const magicLinkTokens = pgTable("magic_link_tokens", {
  token: text().primaryKey().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  // Never written: single use is enforced by deleting the row on verify, not by
  // setting usedAt. Column kept for shape parity — do not "fix" this.
  usedAt: timestamp("used_at", { withTimezone: true }),
  userId: uuid("user_id").notNull().references(() => users.id),
});

export const magicLinkTokensRelations = relations(magicLinkTokens, ({ one }) => {
  return {
    user: one(users, {
      fields: [magicLinkTokens.userId],
      references: [users.id],
    }),
  };
});
