import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core";

// Every mutation uses version as a compare-and-swap guard. Tokens stay inside
// private state; the API always builds a separate public snapshot.
export const rooms = sqliteTable("rooms", {
  code: text("code").primaryKey(),
  state: text("state").notNull(),
  version: integer("version").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [index("rooms_updated_at_idx").on(table.updatedAt)]);
