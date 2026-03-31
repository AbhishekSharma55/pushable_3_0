import type { FastifyInstance } from "fastify";
import { runReportRepository } from "../repositories/runReport.repository.ts";
import { AppError, UnauthorizedError } from "../lib/errors.ts";

export async function runReportRoutes(fastify: FastifyInstance) {
    fastify.addHook("onRequest", async (request) => {
        try { await request.jwtVerify(); } catch { throw new UnauthorizedError("Invalid or expired token"); }
    });
    fastify.addHook("preHandler", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        if (!workspaceId) throw new AppError("x-workspace-id header is required", 400, "MISSING_WORKSPACE");
    });

    // GET /run-reports
    fastify.get("/run-reports", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { agentId, projectId, since, limit, offset } = request.query as {
            agentId?: string;
            projectId?: string;
            since?: string;
            limit?: string;
            offset?: string;
        };
        const reports = await runReportRepository.findByWorkspace(workspaceId, {
            agentId,
            projectId,
            since: since ? new Date(since) : undefined,
            limit: limit ? parseInt(limit, 10) : 50,
            offset: offset ? parseInt(offset, 10) : 0,
        });
        return { data: reports };
    });

    // GET /run-reports/:id
    fastify.get("/run-reports/:id", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        const report = await runReportRepository.findById(id, workspaceId);
        if (!report) throw new AppError("Run report not found", 404, "REPORT_NOT_FOUND");
        return { data: report };
    });
}
