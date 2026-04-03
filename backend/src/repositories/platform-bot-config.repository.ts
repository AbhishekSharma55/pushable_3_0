import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { platformBotConfigs } from "../db/schema/index.ts";

export const platformBotConfigRepository = {
    async findByPlatform(platform: string) {
        const result = await db
            .select()
            .from(platformBotConfigs)
            .where(eq(platformBotConfigs.platform, platform))
            .limit(1);
        return result[0] ?? null;
    },

    async findAll() {
        return db.select().from(platformBotConfigs).orderBy(platformBotConfigs.platform);
    },

    async upsert(data: {
        platform: string;
        config: Record<string, unknown>;
        botName?: string | null;
        botUsername?: string | null;
        updatedBy?: string | null;
    }) {
        const result = await db
            .insert(platformBotConfigs)
            .values({
                platform: data.platform,
                config: data.config,
                botName: data.botName ?? null,
                botUsername: data.botUsername ?? null,
                updatedBy: data.updatedBy ?? null,
            })
            .onConflictDoUpdate({
                target: platformBotConfigs.platform,
                set: {
                    config: data.config,
                    botName: data.botName ?? null,
                    botUsername: data.botUsername ?? null,
                    updatedBy: data.updatedBy ?? null,
                    updatedAt: new Date(),
                },
            })
            .returning();
        return result[0];
    },

    async updateStatus(
        platform: string,
        status: string,
        errorMessage?: string | null
    ) {
        const result = await db
            .update(platformBotConfigs)
            .set({
                status,
                errorMessage: errorMessage ?? null,
                updatedAt: new Date(),
            })
            .where(eq(platformBotConfigs.platform, platform))
            .returning();
        return result[0] ?? null;
    },
};
