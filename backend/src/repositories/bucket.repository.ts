import { eq, and, or, sql, desc, ilike } from "drizzle-orm";
import { db } from "../db/client.ts";
import { bucketFiles } from "../db/schema/index.ts";

export const bucketRepository = {
    async createFile(data: {
        workspaceId: string;
        filename: string;
        storageKey: string;
        mimeType: string;
        sizeBytes: number;
        folder: string;
        source: "chat_upload" | "agent_generated" | "api_upload";
        sessionId?: string;
        agentId?: string;
        uploadedBy?: string;
        metadata?: Record<string, unknown>;
    }) {
        const result = await db
            .insert(bucketFiles)
            .values({
                workspaceId: data.workspaceId,
                filename: data.filename,
                storageKey: data.storageKey,
                mimeType: data.mimeType,
                sizeBytes: data.sizeBytes,
                folder: data.folder,
                source: data.source,
                sessionId: data.sessionId || null,
                agentId: data.agentId || null,
                uploadedBy: data.uploadedBy || null,
                metadata: data.metadata || {},
            })
            .returning();
        return result[0];
    },

    async findById(id: string, workspaceId: string) {
        const result = await db
            .select()
            .from(bucketFiles)
            .where(
                and(
                    eq(bucketFiles.id, id),
                    eq(bucketFiles.workspaceId, workspaceId)
                )
            )
            .limit(1);
        return result[0] ?? null;
    },

    async findByWorkspace(
        workspaceId: string,
        options?: {
            folder?: string;
            folders?: string[];
            source?: string;
            search?: string;
            limit?: number;
            offset?: number;
        }
    ) {
        const conditions = [eq(bucketFiles.workspaceId, workspaceId)];

        if (options?.folder) {
            conditions.push(eq(bucketFiles.folder, options.folder));
        } else if (options?.folders && options.folders.length > 0) {
            conditions.push(
                or(...options.folders.map((f) => eq(bucketFiles.folder, f)))!
            );
        }
        if (options?.source) {
            conditions.push(
                eq(
                    bucketFiles.source,
                    options.source as "chat_upload" | "agent_generated" | "api_upload"
                )
            );
        }
        if (options?.search) {
            conditions.push(ilike(bucketFiles.filename, `%${options.search}%`));
        }

        const query = db
            .select()
            .from(bucketFiles)
            .where(and(...conditions))
            .orderBy(desc(bucketFiles.createdAt));

        if (options?.limit) {
            query.limit(options.limit);
        }
        if (options?.offset) {
            query.offset(options.offset);
        }

        return query;
    },

    async findBySession(sessionId: string, workspaceId: string) {
        return db
            .select()
            .from(bucketFiles)
            .where(
                and(
                    eq(bucketFiles.sessionId, sessionId),
                    eq(bucketFiles.workspaceId, workspaceId)
                )
            )
            .orderBy(desc(bucketFiles.createdAt));
    },

    async findByFilename(filename: string, workspaceId: string, folders?: string[]) {
        const conditions = [
            eq(bucketFiles.filename, filename),
            eq(bucketFiles.workspaceId, workspaceId),
        ];
        if (folders && folders.length > 0) {
            conditions.push(
                or(...folders.map((f) => eq(bucketFiles.folder, f)))!
            );
        }
        const result = await db
            .select()
            .from(bucketFiles)
            .where(and(...conditions))
            .orderBy(desc(bucketFiles.createdAt))
            .limit(1);
        return result[0] ?? null;
    },

    async updateFile(
        id: string,
        workspaceId: string,
        data: Partial<{
            filename: string;
            folder: string;
            metadata: Record<string, unknown>;
        }>
    ) {
        const result = await db
            .update(bucketFiles)
            .set({ ...data, updatedAt: new Date() })
            .where(
                and(
                    eq(bucketFiles.id, id),
                    eq(bucketFiles.workspaceId, workspaceId)
                )
            )
            .returning();
        return result[0] ?? null;
    },

    async deleteFile(id: string, workspaceId: string) {
        const result = await db
            .delete(bucketFiles)
            .where(
                and(
                    eq(bucketFiles.id, id),
                    eq(bucketFiles.workspaceId, workspaceId)
                )
            )
            .returning();
        return result[0] ?? null;
    },

    async getStorageUsage(workspaceId: string) {
        const result = await db
            .select({
                totalBytes: sql<number>`COALESCE(SUM(${bucketFiles.sizeBytes}), 0)`,
                fileCount: sql<number>`COUNT(*)`,
            })
            .from(bucketFiles)
            .where(eq(bucketFiles.workspaceId, workspaceId));
        return {
            totalBytes: Number(result[0]?.totalBytes ?? 0),
            fileCount: Number(result[0]?.fileCount ?? 0),
        };
    },

    async listFolders(workspaceId: string): Promise<string[]> {
        const result = await db
            .selectDistinct({ folder: bucketFiles.folder })
            .from(bucketFiles)
            .where(eq(bucketFiles.workspaceId, workspaceId))
            .orderBy(bucketFiles.folder);
        return result.map((r) => r.folder);
    },

    async getFileCount(workspaceId: string, folder?: string) {
        const conditions = [eq(bucketFiles.workspaceId, workspaceId)];
        if (folder) {
            conditions.push(eq(bucketFiles.folder, folder));
        }
        const result = await db
            .select({ count: sql<number>`COUNT(*)` })
            .from(bucketFiles)
            .where(and(...conditions));
        return Number(result[0]?.count ?? 0);
    },
};
