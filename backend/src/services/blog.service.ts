import { blogRepository } from "../repositories/blog.repository.ts";
import { NotFoundError } from "../lib/errors.ts";

function generateSlug(title: string): string {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
}

export const blogService = {
    async createBlog(
        data: {
            title: string;
            description?: string;
            content: string;
            emoji?: string;
            tag?: string;
            coverImage?: string;
            author?: string;
            readTime?: string;
            featured?: boolean;
            published?: boolean;
        },
        workspaceId: string
    ) {
        const slug = generateSlug(data.title);
        const publishedAt = data.published ? new Date() : null;
        return blogRepository.create({
            ...data,
            slug,
            workspaceId,
            publishedAt,
        });
    },

    async getBlogs(workspaceId: string) {
        return blogRepository.findByWorkspace(workspaceId);
    },

    async getPublishedBlogs() {
        return blogRepository.findPublished();
    },

    async getBlog(id: string, workspaceId: string) {
        const blog = await blogRepository.findById(id, workspaceId);
        if (!blog) throw new NotFoundError("Blog not found");
        return blog;
    },

    async getPublishedBlogBySlug(slug: string) {
        const blog = await blogRepository.findBySlug(slug);
        if (!blog) throw new NotFoundError("Blog not found");
        return blog;
    },

    async updateBlog(
        id: string,
        workspaceId: string,
        data: Partial<{
            title: string;
            description: string;
            content: string;
            emoji: string;
            tag: string;
            coverImage: string;
            author: string;
            readTime: string;
            featured: boolean;
            published: boolean;
        }>
    ) {
        const blog = await blogRepository.findById(id, workspaceId);
        if (!blog) throw new NotFoundError("Blog not found");

        const updateData: Record<string, unknown> = { ...data };

        // Auto-update slug if title changes
        if (data.title) {
            updateData.slug = generateSlug(data.title);
        }

        // Set publishedAt on first publish
        if (data.published && !blog.publishedAt) {
            updateData.publishedAt = new Date();
        }

        return blogRepository.update(id, workspaceId, updateData as any);
    },

    async deleteBlog(id: string, workspaceId: string) {
        const blog = await blogRepository.findById(id, workspaceId);
        if (!blog) throw new NotFoundError("Blog not found");
        await blogRepository.delete(id, workspaceId);
    },
};
