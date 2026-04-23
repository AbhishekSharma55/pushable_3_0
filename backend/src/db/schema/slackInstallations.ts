import { pgTable, text, timestamp, uuid, boolean } from "drizzle-orm/pg-core";

export const slackInstallations = pgTable("slack_installations", {
    id: uuid("id").primaryKey().defaultRandom(),
    slackTeamId: text("slack_team_id").notNull().unique(),
    slackTeamName: text("slack_team_name"),
    botToken: text("bot_token").notNull(),
    botUserId: text("bot_user_id"),
    botId: text("bot_id"),
    installedBySlackUserId: text("installed_by_slack_user_id"),
    scope: text("scope"),
    isEnterpriseInstall: boolean("is_enterprise_install").default(false),
    enterpriseId: text("enterprise_id"),
    enterpriseName: text("enterprise_name"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
