import type { FastifyInstance } from "fastify";
import { projectService } from "../services/project.service.ts";
import { runReportRepository } from "../repositories/runReport.repository.ts";
import { AppError, UnauthorizedError } from "../lib/errors.ts";

export async function projectRoutes(fastify: FastifyInstance) {
    fastify.addHook("onRequest", async (request) => {
        try { await request.jwtVerify(); } catch { throw new UnauthorizedError("Invalid or expired token"); }
    });
    fastify.addHook("preHandler", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        if (!workspaceId) throw new AppError("x-workspace-id header is required", 400, "MISSING_WORKSPACE");
    });

    // GET /projects
    fastify.get("/projects", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const projects = await projectService.list(workspaceId);
        return { data: projects };
    });

    // GET /projects/:id
    fastify.get("/projects/:id", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        const project = await projectService.getByIdWithDetails(id, workspaceId);
        return { data: project };
    });

    // POST /projects
    fastify.post("/projects", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { name, description, instructions } = request.body as {
            name: string;
            description?: string;
            instructions?: string;
        };
        if (!name) throw new AppError("name is required", 400, "INVALID_BODY");
        const project = await projectService.create({ workspaceId, name, description, instructions });
        return reply.status(201).send({ data: project });
    });

    // PUT /projects/:id
    fastify.put("/projects/:id", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        const body = request.body as {
            name?: string;
            description?: string;
            instructions?: string;
            status?: string;
        };
        const project = await projectService.update(id, workspaceId, body);
        return { data: project };
    });

    // DELETE /projects/:id
    fastify.delete("/projects/:id", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        await projectService.delete(id, workspaceId);
        return reply.status(204).send();
    });

    // POST /projects/:id/agents — assign agent
    fastify.post("/projects/:id/agents", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        const { agentId, roleInProject } = request.body as { agentId: string; roleInProject?: string };
        if (!agentId) throw new AppError("agentId is required", 400, "INVALID_BODY");
        const result = await projectService.assignAgent(id, agentId, workspaceId, roleInProject);
        return reply.status(201).send({ data: result });
    });

    // DELETE /projects/:id/agents/:agentId — remove agent
    fastify.delete("/projects/:id/agents/:agentId", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id, agentId } = request.params as { id: string; agentId: string };
        await projectService.removeAgent(id, agentId, workspaceId);
        return reply.status(204).send();
    });

    // POST /projects/:id/milestones — create milestone
    fastify.post("/projects/:id/milestones", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        const { title, description, targetDate } = request.body as {
            title: string;
            description?: string;
            targetDate?: string;
        };
        if (!title) throw new AppError("title is required", 400, "INVALID_BODY");
        const milestone = await projectService.createMilestone({
            projectId: id,
            workspaceId,
            title,
            description,
            targetDate: targetDate ? new Date(targetDate) : undefined,
        });
        return reply.status(201).send({ data: milestone });
    });

    // PUT /projects/:id/milestones/:milestoneId — update milestone
    fastify.put("/projects/:id/milestones/:milestoneId", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { milestoneId } = request.params as { id: string; milestoneId: string };
        const body = request.body as {
            title?: string;
            description?: string;
            status?: string;
            targetDate?: string;
            evaluationNotes?: string;
            sortOrder?: number;
        };
        const updates: Record<string, unknown> = {};
        if (body.title) updates.title = body.title;
        if (body.description !== undefined) updates.description = body.description;
        if (body.status) updates.status = body.status;
        if (body.targetDate) updates.targetDate = new Date(body.targetDate);
        if (body.evaluationNotes !== undefined) updates.evaluationNotes = body.evaluationNotes;
        if (body.sortOrder !== undefined) updates.sortOrder = body.sortOrder;
        if (body.status === "completed") updates.completedAt = new Date();
        const milestone = await projectService.updateMilestone(milestoneId, workspaceId, updates);
        return { data: milestone };
    });

    // DELETE /projects/:id/milestones/:milestoneId — delete milestone
    fastify.delete("/projects/:id/milestones/:milestoneId", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { milestoneId } = request.params as { id: string; milestoneId: string };
        await projectService.deleteMilestone(milestoneId, workspaceId);
        return reply.status(204).send();
    });

    // POST /projects/:id/kb — assign KB
    fastify.post("/projects/:id/kb", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        const { kbId } = request.body as { kbId: string };
        if (!kbId) throw new AppError("kbId is required", 400, "INVALID_BODY");
        const result = await projectService.assignKB(id, kbId, workspaceId);
        return reply.status(201).send({ data: result });
    });

    // DELETE /projects/:id/kb/:kbId — remove KB
    fastify.delete("/projects/:id/kb/:kbId", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id, kbId } = request.params as { id: string; kbId: string };
        await projectService.removeKB(id, kbId, workspaceId);
        return reply.status(204).send();
    });

    // GET /projects/:id/reports — get run reports for project
    fastify.get("/projects/:id/reports", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        const { since } = request.query as { since?: string };
        const sinceDate = since ? new Date(since) : undefined;
        const reports = await runReportRepository.findByProject(id, workspaceId, { since: sinceDate });
        return { data: reports };
    });
}
