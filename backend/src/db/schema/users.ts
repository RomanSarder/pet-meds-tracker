import { relations } from "drizzle-orm";
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sessions } from "./sessions";
import { magicLinkTokens } from "./magic-link-tokens";

export const users = pgTable("users", {
  id: uuid().primaryKey().defaultRandom(),
  email: text().unique().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const usersRelations = relations(users, ({ one, many }) => {
  return {
    session: one(sessions),
    magicLinkTokens: many(magicLinkTokens),
  };
});
