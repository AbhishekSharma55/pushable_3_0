import { eq, and, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
    knowledgeBases,
    kbDocuments,
    kbChunks,
} from "../db/schema/index.ts";

export const kbRepository = {
    // --- Knowledge Bases ---

    async createKB(data: {
        workspaceId: string;
        name: string;
        description?: string;
    }) {
        const result = await db
            .insert(knowledgeBases)
            .values(data)
            .returning();
        return result[0];
    },

    async findKBById(id: string, workspaceId: string) {
        const result = await db
            .select()
            .from(knowledgeBases)
            .where(
                and(
                    eq(knowledgeBases.id, id),
                    eq(knowledgeBases.workspaceId, workspaceId)
                )
            )
            .limit(1);
        return result[0] ?? null;
    },

    async findKBsByWorkspace(workspaceId: string) {
        return db
            .select()
            .from(knowledgeBases)
            .where(eq(knowledgeBases.workspaceId, workspaceId))
            .orderBy(knowledgeBases.createdAt);
    },

    async updateKB(
        id: string,
        workspaceId: string,
        data: Partial<{ name: string; description: string }>
    ) {
        const result = await db
            .update(knowledgeBases)
            .set({ ...data, updatedAt: new Date() })
            .where(
                and(
                    eq(knowledgeBases.id, id),
                    eq(knowledgeBases.workspaceId, workspaceId)
                )
            )
            .returning();
        return result[0] ?? null;
    },

    async deleteKB(id: string, workspaceId: string) {
        // Chunks and documents cascade-deleted via FK
        await db
            .delete(knowledgeBases)
            .where(
                and(
                    eq(knowledgeBases.id, id),
                    eq(knowledgeBases.workspaceId, workspaceId)
                )
            );
    },

    // --- Documents ---

    async createDocument(data: {
        workspaceId: string;
        kbId: string;
        filename: string;
        chunkCount: number;
    }) {
        const result = await db.insert(kbDocuments).values(data).returning();
        return result[0];
    },

    async findDocumentsByKB(kbId: string, workspaceId: string) {
        return db
            .select()
            .from(kbDocuments)
            .where(
                and(
                    eq(kbDocuments.kbId, kbId),
                    eq(kbDocuments.workspaceId, workspaceId)
                )
            )
            .orderBy(kbDocuments.createdAt);
    },

    async deleteDocument(id: string, workspaceId: string) {
        // Chunks cascade-deleted via FK
        await db
            .delete(kbDocuments)
            .where(
                and(
                    eq(kbDocuments.id, id),
                    eq(kbDocuments.workspaceId, workspaceId)
                )
            );
    },

    // --- Chunks ---

    async insertChunks(
        chunks: {
            workspaceId: string;
            kbId: string;
            documentId: string;
            content: string;
            embedding: number[];
            metadata: Record<string, unknown>;
        }[]
    ) {
        if (chunks.length === 0) return;
        await db.insert(kbChunks).values(chunks);
    },

    async searchChunks(
        workspaceId: string,
        kbId: string,
        queryEmbedding: number[],
        topK: number
    ) {
        const embeddingStr = `{${queryEmbedding.join(",")}}`;
        const result = await db.execute(sql`
            SELECT
                id,
                kb_id,
                document_id,
                content,
                metadata,
                created_at,
                (
                    SELECT SUM(a * b) / (
                        SQRT(NULLIF(SUM(a * a), 0)) * SQRT(NULLIF(SUM(b * b), 0))
                    )
                    FROM UNNEST(embedding, ${embeddingStr}::real[]) AS t(a, b)
                ) AS similarity
            FROM kb_chunks
            WHERE workspace_id = ${workspaceId}
              AND kb_id = ${kbId}
            ORDER BY similarity DESC
            LIMIT ${topK}
        `);
        return result as unknown as {
            id: string;
            kb_id: string;
            document_id: string;
            content: string;
            metadata: Record<string, unknown>;
            created_at: string;
            similarity: number;
        }[];
    },

    async searchAcrossKBs(
        workspaceId: string,
        kbIds: string[],
        queryEmbedding: number[],
        topK: number
    ) {
        if (kbIds.length === 0) return [];
        const embeddingStr = `{${queryEmbedding.join(",")}}`;
        const kbIdsList = kbIds.map((id) => `'${id}'`).join(",");
        const result = await db.execute(sql`
            SELECT
                id,
                kb_id,
                document_id,
                content,
                metadata,
                created_at,
                (
                    SELECT SUM(a * b) / (
                        SQRT(NULLIF(SUM(a * a), 0)) * SQRT(NULLIF(SUM(b * b), 0))
                    )
                    FROM UNNEST(embedding, ${embeddingStr}::real[]) AS t(a, b)
                ) AS similarity
            FROM kb_chunks
            WHERE workspace_id = ${workspaceId}
              AND kb_id IN (${sql.raw(kbIdsList)})
            ORDER BY similarity DESC
            LIMIT ${topK}
        `);
        return result as unknown as {
            id: string;
            kb_id: string;
            document_id: string;
            content: string;
            metadata: Record<string, unknown>;
            created_at: string;
            similarity: number;
        }[];
    },

    async getChunkCountByKB(kbId: string, workspaceId: string) {
        const result = await db
            .select({ count: sql<number>`COUNT(*)` })
            .from(kbChunks)
            .where(
                and(
                    eq(kbChunks.kbId, kbId),
                    eq(kbChunks.workspaceId, workspaceId)
                )
            );
        return Number(result[0]?.count ?? 0);
    },
};
