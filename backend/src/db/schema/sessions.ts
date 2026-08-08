import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";
import { relations } from "drizzle-orm";

export const sessions = pgTable("sessions", {
  id: text().unique().primaryKey(),
  secretHash: text("secret_hash"),
  userId: uuid("user_id").notNull().references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const sessionsRelations = relations(sessions, ({ one }) => {
  return {
    user: one(users, {
      fields: [sessions.userId],
      references: [users.id],
    }),
  };
});
