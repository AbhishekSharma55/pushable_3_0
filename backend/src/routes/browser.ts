import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { browserService } from "../services/browser.service.ts";
import { AppError, UnauthorizedError } from "../lib/errors.ts";

const createProfileSchema = z.object({
    name: z.string().min(1, "Name is required"),
    assignedAgentId: z.string().uuid().nullable().optional(),
    os: z.enum(["windows", "macos", "linux"]).default("windows"),
});

const updateProfileSchema = z.object({
    name: z.string().min(1).optional(),
    assignedAgentId: z.string().uuid().nullable().optional(),
    os: z.enum(["windows", "macos", "linux"]).optional(),
    status: z.enum(["active", "inactive"]).optional(),
});

const startSessionSchema = z.object({
    profileId: z.string().uuid(),
    agentId: z.string().uuid().optional(),
});

export async function browserRoutes(fastify: FastifyInstance) {
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

    // GET /browser/profiles
    fastify.get("/browser/profiles", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const profiles = await browserService.getProfiles(workspaceId);
        return { data: profiles };
    });

    // POST /browser/profiles
    fastify.post("/browser/profiles", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const body = createProfileSchema.parse(request.body);
        const profile = await browserService.createProfile(body, workspaceId);
        return reply.status(201).send({ data: profile });
    });

    // PUT /browser/profiles/:id
    fastify.put("/browser/profiles/:id", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        const body = updateProfileSchema.parse(request.body);
        const profile = await browserService.updateProfile(
            id,
            workspaceId,
            body
        );
        return { data: profile };
    });

    // DELETE /browser/profiles/:id
    fastify.delete("/browser/profiles/:id", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        await browserService.deleteProfile(id, workspaceId);
        return reply.status(204).send();
    });

    // POST /browser/sessions/start
    fastify.post("/browser/sessions/start", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const body = startSessionSchema.parse(request.body);
        const result = await browserService.startSession(
            body.profileId,
            workspaceId,
            body.agentId
        );
        return reply.status(201).send({ data: result });
    });

    // DELETE /browser/sessions/:id
    fastify.delete("/browser/sessions/:id", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        await browserService.endSession(id, workspaceId);
        return reply.status(204).send();
    });

    // GET /browser/sessions
    fastify.get("/browser/sessions", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const sessions = await browserService.getSessions(workspaceId);
        return { data: sessions };
    });
}
