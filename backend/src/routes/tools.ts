import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { toolService } from "../services/tool.service.ts";
import { AppError, UnauthorizedError } from "../lib/errors.ts";

const createToolSchema = z.object({
    name: z.string().min(1, "Name is required"),
    description: z.string().optional(),
    type: z.enum(["mcp", "function"]),
    isGlobal: z.boolean().default(false),
    config: z.record(z.string(), z.unknown()).default({}),
});

const updateToolSchema = z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    type: z.enum(["mcp", "function"]).optional(),
    isGlobal: z.boolean().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
});

export async function toolRoutes(fastify: FastifyInstance) {
    // Auth preHandler
    fastify.addHook("onRequest", async (request) => {
        try {
            await request.jwtVerify();
        } catch {
            throw new UnauthorizedError("Invalid or expired token");
        }
    });

    // Validate x-workspace-id header
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

    // GET /tools
    fastify.get("/tools", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const tools = await toolService.getTools(workspaceId);
        return { data: tools };
    });

    // POST /tools
    fastify.post("/tools", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const body = createToolSchema.parse(request.body);
        const tool = await toolService.createTool(body, workspaceId);
        return reply.status(201).send({ data: tool });
    });

    // GET /tools/:id
    fastify.get("/tools/:id", async (request) => {
        const { id } = request.params as { id: string };
        const tool = await toolService.getTool(id);
        return { data: tool };
    });

    // PUT /tools/:id
    fastify.put("/tools/:id", async (request) => {
        const { id } = request.params as { id: string };
        const body = updateToolSchema.parse(request.body);
        const tool = await toolService.updateTool(id, body);
        return { data: tool };
    });

    // DELETE /tools/:id
    fastify.delete("/tools/:id", async (request, reply) => {
        const { id } = request.params as { id: string };
        await toolService.deleteTool(id);
        return reply.status(204).send();
    });
}
