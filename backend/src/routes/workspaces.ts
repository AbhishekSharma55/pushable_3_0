import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { workspaceService } from "../services/workspace.service.ts";
import { UnauthorizedError } from "../lib/errors.ts";
import type { JWTPayload } from "../lib/jwt.ts";

// Augment @fastify/jwt to type the decoded user payload
declare module "@fastify/jwt" {
    interface FastifyJWT {
        payload: JWTPayload;
        user: JWTPayload;
    }
}

const createWorkspaceSchema = z.object({
    name: z.string().min(1, "Name is required"),
});

export async function workspaceRoutes(fastify: FastifyInstance) {
    // Auth preHandler for all routes in this plugin
    fastify.addHook("onRequest", async (request) => {
        try {
            await request.jwtVerify();
        } catch {
            throw new UnauthorizedError("Invalid or expired token");
        }
    });

    fastify.get("/workspaces", async (request) => {
        const workspaces = await workspaceService.getWorkspaces(
            request.user.userId
        );
        return { data: workspaces };
    });

    fastify.post("/workspaces", async (request, reply) => {
        const body = createWorkspaceSchema.parse(request.body);
        const workspace = await workspaceService.createWorkspace(
            body,
            request.user.userId
        );
        return reply.status(201).send({ data: workspace });
    });

    fastify.get("/workspaces/:id", async (request) => {
        const { id } = request.params as { id: string };
        const workspace = await workspaceService.getWorkspaceById(
            id,
            request.user.userId
        );
        return { data: workspace };
    });
}
