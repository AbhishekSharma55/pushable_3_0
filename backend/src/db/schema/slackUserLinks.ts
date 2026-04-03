import { pgTable, text, timestamp, uuid, unique } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";
import { users } from "./users.ts";

export const slackUserLinks = pgTable("slack_user_links", {
    id: uuid("id").primaryKey().defaultRandom(),
    slackUserId: text("slack_user_id").notNull(),
    slackTeamId: text("slack_team_id").notNull(),
    slackUsername: text("slack_username"),
    slackDisplayName: text("slack_display_name"),
    slackDmChannelId: text("slack_dm_channel_id"),
    workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, {
        onDelete: "set null",
    }),
    verifiedAt: timestamp("verified_at"),
    lastMessageAt: timestamp("last_message_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
    unique("slack_user_links_team_user_unique").on(table.slackTeamId, table.slackUserId),
]);
