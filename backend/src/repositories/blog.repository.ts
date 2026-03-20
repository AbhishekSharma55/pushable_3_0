import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/client.ts";
import { blogs } from "../db/schema/index.ts";

export const blogRepository = {
    async create(data: {
        workspaceId: string;
        title: string;
        slug: string;
        description?: string;
        content: string;
        emoji?: string;
        tag?: string;
        coverImage?: string;
        author?: string;
        readTime?: string;
        featured?: boolean;
        published?: boolean;
        publishedAt?: Date | null;
    }) {
        const result = await db.insert(blogs).values(data).returning();
        return result[0];
    },

    async findById(id: string, workspaceId: string) {
        const result = await db
            .select()
            .from(blogs)
            .where(
                and(eq(blogs.id, id), eq(blogs.workspaceId, workspaceId))
            )
            .limit(1);
        return result[0] ?? null;
    },

    async findBySlug(slug: string) {
        const result = await db
            .select()
            .from(blogs)
            .where(
                and(eq(blogs.slug, slug), eq(blogs.published, true))
            )
            .limit(1);
        return result[0] ?? null;
    },

    async findByWorkspace(workspaceId: string) {
        return db
            .select()
            .from(blogs)
            .where(eq(blogs.workspaceId, workspaceId))
            .orderBy(desc(blogs.createdAt));
    },

    async findPublished() {
        return db
            .select()
            .from(blogs)
            .where(eq(blogs.published, true))
            .orderBy(desc(blogs.publishedAt));
    },

    async update(
        id: string,
        workspaceId: string,
        data: Partial<{
            title: string;
            slug: string;
            description: string;
            content: string;
            emoji: string;
            tag: string;
            coverImage: string;
            author: string;
            readTime: string;
            featured: boolean;
            published: boolean;
            publishedAt: Date | null;
        }>
    ) {
        const result = await db
            .update(blogs)
            .set({ ...data, updatedAt: new Date() })
            .where(
                and(eq(blogs.id, id), eq(blogs.workspaceId, workspaceId))
            )
            .returning();
        return result[0] ?? null;
    },

    async delete(id: string, workspaceId: string) {
        await db
            .delete(blogs)
            .where(
                and(eq(blogs.id, id), eq(blogs.workspaceId, workspaceId))
            );
    },
};
