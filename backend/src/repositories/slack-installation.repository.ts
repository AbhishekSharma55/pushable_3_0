import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { slackInstallations } from "../db/schema/index.ts";

export const slackInstallationRepository = {
    async findByTeamId(teamId: string) {
        const result = await db
            .select()
            .from(slackInstallations)
            .where(eq(slackInstallations.slackTeamId, teamId))
            .limit(1);
        return result[0] ?? null;
    },

    async findAll() {
        return db.select().from(slackInstallations);
    },

    async upsert(data: {
        slackTeamId: string;
        slackTeamName?: string;
        botToken: string;
        botUserId?: string;
        botId?: string;
        installedBySlackUserId?: string;
        scope?: string;
        isEnterpriseInstall?: boolean;
        enterpriseId?: string;
        enterpriseName?: string;
    }) {
        const result = await db
            .insert(slackInstallations)
            .values(data)
            .onConflictDoUpdate({
                target: slackInstallations.slackTeamId,
                set: {
                    slackTeamName: data.slackTeamName,
                    botToken: data.botToken,
                    botUserId: data.botUserId,
                    botId: data.botId,
                    installedBySlackUserId: data.installedBySlackUserId,
                    scope: data.scope,
                    isEnterpriseInstall: data.isEnterpriseInstall,
                    enterpriseId: data.enterpriseId,
                    enterpriseName: data.enterpriseName,
                    updatedAt: new Date(),
                },
            })
            .returning();
        return result[0];
    },

    async deleteByTeamId(teamId: string) {
        await db
            .delete(slackInstallations)
            .where(eq(slackInstallations.slackTeamId, teamId));
    },
};
