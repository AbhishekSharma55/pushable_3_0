import { eq, and, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { browserProxies } from "../db/schema/index.ts";

export const browserProxyRepository = {
    async createProxy(data: {
        workspaceId: string;
        label: string;
        host: string;
        port: number;
        username: string;
        password: string;
        protocol?: "http" | "https" | "socks5";
        country?: string | null;
        city?: string | null;
    }) {
        const result = await db
            .insert(browserProxies)
            .values(data)
            .returning();
        return result[0];
    },

    async findProxies(workspaceId: string) {
        return db
            .select()
            .from(browserProxies)
            .where(eq(browserProxies.workspaceId, workspaceId))
            .orderBy(browserProxies.createdAt);
    },

    async findProxyById(id: string, workspaceId: string) {
        const result = await db
            .select()
            .from(browserProxies)
            .where(
                and(
                    eq(browserProxies.id, id),
                    eq(browserProxies.workspaceId, workspaceId)
                )
            )
            .limit(1);
        return result[0] ?? null;
    },

    async updateProxy(
        id: string,
        workspaceId: string,
        data: Partial<{
            label: string;
            host: string;
            port: number;
            username: string;
            password: string;
            protocol: "http" | "https" | "socks5";
            country: string | null;
            city: string | null;
            isActive: boolean;
        }>
    ) {
        const result = await db
            .update(browserProxies)
            .set({ ...data, updatedAt: new Date() })
            .where(
                and(
                    eq(browserProxies.id, id),
                    eq(browserProxies.workspaceId, workspaceId)
                )
            )
            .returning();
        return result[0] ?? null;
    },

    async deleteProxy(id: string, workspaceId: string) {
        await db
            .delete(browserProxies)
            .where(
                and(
                    eq(browserProxies.id, id),
                    eq(browserProxies.workspaceId, workspaceId)
                )
            );
    },

    async updateTestStatus(
        id: string,
        status: "success" | "failed" | "untested"
    ) {
        const result = await db
            .update(browserProxies)
            .set({
                lastTestStatus: status,
                lastTestedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(browserProxies.id, id))
            .returning();
        return result[0] ?? null;
    },

    /** Pick the best active proxy for a workspace — prefers tested/successful, then untested, never failed */
    async findFirstActiveProxy(workspaceId: string) {
        const result = await db
            .select()
            .from(browserProxies)
            .where(
                and(
                    eq(browserProxies.workspaceId, workspaceId),
                    eq(browserProxies.isActive, true)
                )
            )
            .orderBy(
                // success=0 (best), untested=1, failed=2 (worst)
                sql`CASE ${browserProxies.lastTestStatus} WHEN 'success' THEN 0 WHEN 'untested' THEN 1 ELSE 2 END`,
                browserProxies.createdAt
            )
            .limit(1);
        return result[0] ?? null;
    },
};
