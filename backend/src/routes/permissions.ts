import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { permissionService } from "../services/permission.service.ts";
import { AppError, UnauthorizedError } from "../lib/errors.ts";

const setPermissionsSchema = z.object({
    permissions: z.array(
        z.object({
            resourceType: z.enum(["tool", "kb", "skill", "agent"]),
            resourceId: z.string().uuid(),
            allowed: z.boolean(),
        })
    ),
});

export async function permissionRoutes(fastify: FastifyInstance) {
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

    // GET /agents/:agentId/permissions
    fastify.get("/agents/:agentId/permissions", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { agentId } = request.params as { agentId: string };
        const permissions = await permissionService.getAgentPermissions(
            agentId,
            workspaceId
        );
        return { data: permissions };
    });

    // POST /agents/:agentId/permissions
    fastify.post("/agents/:agentId/permissions", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { agentId } = request.params as { agentId: string };
        const body = setPermissionsSchema.parse(request.body);
        const permissions = await permissionService.setPermissions(
            agentId,
            workspaceId,
            body.permissions
        );
        return reply.status(200).send({ data: permissions });
    });
}
