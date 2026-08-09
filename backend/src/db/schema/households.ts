import { relations } from "drizzle-orm";
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";
import { joinCodes } from "./join-codes";

export const households = pgTable("households", {
  id: uuid().primaryKey().defaultRandom(),
  name: text(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const householdsRelations = relations(households, ({ many }) => {
  return {
    members: many(users),
    joinCodes: many(joinCodes),
  };
});
