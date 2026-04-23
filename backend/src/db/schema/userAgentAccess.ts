import { boolean, pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";
import { users } from "./users.ts";
import { agents } from "./agents.ts";

export const userAgentAccess = pgTable(
    "user_agent_access",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        workspaceId: uuid("workspace_id")
            .notNull()
            .references(() => workspaces.id, { onDelete: "cascade" }),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        agentId: uuid("agent_id")
            .notNull()
            .references(() => agents.id, { onDelete: "cascade" }),
        allowed: boolean("allowed").default(true).notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [unique().on(table.workspaceId, table.userId, table.agentId)]
);
