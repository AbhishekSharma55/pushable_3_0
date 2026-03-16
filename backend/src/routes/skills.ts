import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { skillService } from "../services/skill.service.ts";
import { AppError, UnauthorizedError } from "../lib/errors.ts";

const createSkillSchema = z.object({
    name: z.string().min(1, "Name is required"),
    description: z.string().optional(),
    origin: z.string().optional(),
    instructions: z.string().min(1, "Instructions are required"),
});

const updateSkillSchema = z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    origin: z.string().optional(),
    instructions: z.string().min(1).optional(),
});

export async function skillRoutes(fastify: FastifyInstance) {
    // Auth
    fastify.addHook("onRequest", async (request) => {
        try {
            await request.jwtVerify();
        } catch {
            throw new UnauthorizedError("Invalid or expired token");
        }
    });

    // Validate workspace header
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

    // GET /skills
    fastify.get("/skills", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const skills = await skillService.getSkills(workspaceId);
        return { data: skills };
    });

    // POST /skills
    fastify.post("/skills", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const body = createSkillSchema.parse(request.body);
        const skill = await skillService.createSkill(body, workspaceId);
        return reply.status(201).send({ data: skill });
    });

    // GET /skills/:id
    fastify.get("/skills/:id", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        const skill = await skillService.getSkill(id, workspaceId);
        return { data: skill };
    });

    // PUT /skills/:id
    fastify.put("/skills/:id", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        const body = updateSkillSchema.parse(request.body);
        const skill = await skillService.updateSkill(id, workspaceId, body);
        return { data: skill };
    });

    // DELETE /skills/:id
    fastify.delete("/skills/:id", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        await skillService.deleteSkill(id, workspaceId);
        return reply.status(204).send();
    });
}
