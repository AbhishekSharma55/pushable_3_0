import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";
import { users } from "./users.ts";
import { memberRoleEnum } from "./workspaceMembers.ts";

export const invitationStatusEnum = pgEnum("invitation_status", [
    "pending",
    "accepted",
    "expired",
    "revoked",
]);

export const workspaceInvitations = pgTable("workspace_invitations", {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: memberRoleEnum("role").default("member").notNull(),
    invitedBy: uuid("invited_by")
        .notNull()
        .references(() => users.id),
    token: text("token").unique().notNull(),
    status: invitationStatusEnum("status").default("pending").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    acceptedAt: timestamp("accepted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});
