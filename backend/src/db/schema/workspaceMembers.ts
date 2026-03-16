import { pgEnum, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users.ts";
import { workspaces } from "./workspaces.ts";

export const memberRoleEnum = pgEnum("member_role", [
    "owner",
    "admin",
    "member",
]);

export const workspaceMembers = pgTable("workspace_members", {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    role: memberRoleEnum("role").default("member").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});
