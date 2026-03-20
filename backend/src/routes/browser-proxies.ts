import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { browserProxyService } from "../services/browser-proxy.service.ts";
import { AppError, UnauthorizedError } from "../lib/errors.ts";

const createProxySchema = z.object({
    label: z.string().min(1, "Label is required"),
    connectionString: z.string().optional(),
    host: z.string().optional(),
    port: z.number().int().positive().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    protocol: z.enum(["http", "https", "socks5"]).optional(),
    country: z.string().max(2).optional(),
    city: z.string().optional(),
});

const updateProxySchema = z.object({
    label: z.string().min(1).optional(),
    host: z.string().optional(),
    port: z.number().int().positive().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    protocol: z.enum(["http", "https", "socks5"]).optional(),
    country: z.string().max(2).nullable().optional(),
    city: z.string().nullable().optional(),
    isActive: z.boolean().optional(),
});

export async function browserProxyRoutes(fastify: FastifyInstance) {
    fastify.addHook("onRequest", async (request) => {
        try {
            await request.jwtVerify();
        } catch {
            throw new UnauthorizedError("Invalid or expired token");
        }
    });

    fastify.addHook("preHandler", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        if (!workspaceId) {
            throw new AppError(
                "x-workspace-id header is required",
                400,
                "MISSING_WORKSPACE"
            );
        }
    });

    // GET /browser/proxies
    fastify.get("/browser/proxies", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const proxies = await browserProxyService.getProxies(workspaceId);
        return { data: proxies };
    });

    // POST /browser/proxies
    fastify.post("/browser/proxies", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const body = createProxySchema.parse(request.body);
        const proxy = await browserProxyService.createProxy(body, workspaceId);
        const { password: _pw, ...safe } = proxy;
        return reply.status(201).send({ data: safe });
    });

    // POST /browser/proxies/:id/test
    fastify.post("/browser/proxies/:id/test", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        const result = await browserProxyService.testProxy(id, workspaceId);
        return { data: result };
    });

    // PUT /browser/proxies/:id
    fastify.put("/browser/proxies/:id", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        const body = updateProxySchema.parse(request.body);
        const proxy = await browserProxyService.updateProxy(id, workspaceId, body);
        if (proxy) {
            const { password: _pw, ...safe } = proxy;
            return { data: safe };
        }
        return { data: null };
    });

    // DELETE /browser/proxies/:id
    fastify.delete("/browser/proxies/:id", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        await browserProxyService.deleteProxy(id, workspaceId);
        return reply.status(204).send();
    });
}
