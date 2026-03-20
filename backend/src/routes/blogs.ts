import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { blogService } from "../services/blog.service.ts";
import { AppError, UnauthorizedError } from "../lib/errors.ts";

const createBlogSchema = z.object({
    title: z.string().min(1, "Title is required"),
    description: z.string().optional(),
    content: z.string().min(1, "Content is required"),
    emoji: z.string().optional(),
    tag: z.string().optional(),
    coverImage: z.string().optional(),
    author: z.string().optional(),
    readTime: z.string().optional(),
    featured: z.boolean().optional(),
    published: z.boolean().optional(),
});

const updateBlogSchema = z.object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    content: z.string().min(1).optional(),
    emoji: z.string().optional(),
    tag: z.string().optional(),
    coverImage: z.string().optional(),
    author: z.string().optional(),
    readTime: z.string().optional(),
    featured: z.boolean().optional(),
    published: z.boolean().optional(),
});

export async function blogRoutes(fastify: FastifyInstance) {
    // ── Public routes (no auth) ──────────────────────────────

    // GET /public/blogs — published blogs for the marketing site
    fastify.get("/public/blogs", async () => {
        const blogs = await blogService.getPublishedBlogs();
        return { data: blogs };
    });

    // GET /public/blogs/:slug — single published blog by slug
    fastify.get("/public/blogs/:slug", async (request) => {
        const { slug } = request.params as { slug: string };
        const blog = await blogService.getPublishedBlogBySlug(slug);
        return { data: blog };
    });

    // ── Authenticated routes (workspace-scoped) ──────────────

    // Auth middleware
    fastify.register(async function authenticatedRoutes(app) {
        app.addHook("onRequest", async (request) => {
            try {
                await request.jwtVerify();
            } catch {
                throw new UnauthorizedError("Invalid or expired token");
            }
        });

        app.addHook("preHandler", async (request) => {
            const workspaceId = request.headers["x-workspace-id"] as string;
            if (!workspaceId) {
                throw new AppError(
                    "x-workspace-id header is required",
                    400,
                    "MISSING_WORKSPACE"
                );
            }
        });

        // GET /blogs
        app.get("/blogs", async (request) => {
            const workspaceId = request.headers["x-workspace-id"] as string;
            const blogs = await blogService.getBlogs(workspaceId);
            return { data: blogs };
        });

        // POST /blogs
        app.post("/blogs", async (request, reply) => {
            const workspaceId = request.headers["x-workspace-id"] as string;
            const body = createBlogSchema.parse(request.body);
            const blog = await blogService.createBlog(body, workspaceId);
            return reply.status(201).send({ data: blog });
        });

        // GET /blogs/:id
        app.get("/blogs/:id", async (request) => {
            const workspaceId = request.headers["x-workspace-id"] as string;
            const { id } = request.params as { id: string };
            const blog = await blogService.getBlog(id, workspaceId);
            return { data: blog };
        });

        // PUT /blogs/:id
        app.put("/blogs/:id", async (request) => {
            const workspaceId = request.headers["x-workspace-id"] as string;
            const { id } = request.params as { id: string };
            const body = updateBlogSchema.parse(request.body);
            const blog = await blogService.updateBlog(id, workspaceId, body);
            return { data: blog };
        });

        // DELETE /blogs/:id
        app.delete("/blogs/:id", async (request, reply) => {
            const workspaceId = request.headers["x-workspace-id"] as string;
            const { id } = request.params as { id: string };
            await blogService.deleteBlog(id, workspaceId);
            return reply.status(204).send();
        });
    });
}
