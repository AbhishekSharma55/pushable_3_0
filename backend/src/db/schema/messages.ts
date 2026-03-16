import {
    integer,
    pgEnum,
    pgTable,
    text,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";
import { sessions } from "./sessions.ts";

export const messageRoleEnum = pgEnum("message_role", [
    "user",
    "assistant",
    "tool",
]);

export const messages = pgTable("messages", {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
        .notNull()
        .references(() => sessions.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    tokenCount: integer("token_count").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});
