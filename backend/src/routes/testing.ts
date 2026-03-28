import type { FastifyInstance } from "fastify";
import { testSuiteRepository } from "../repositories/testSuite.repository.ts";
import { testCaseRepository } from "../repositories/testCase.repository.ts";
import { testerService } from "../services/tester.service.ts";
import { AppError, UnauthorizedError } from "../lib/errors.ts";

export async function testingRoutes(fastify: FastifyInstance) {
    fastify.addHook("onRequest", async (request) => {
        try { await request.jwtVerify(); } catch { throw new UnauthorizedError("Invalid or expired token"); }
    });
    fastify.addHook("preHandler", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        if (!workspaceId) throw new AppError("x-workspace-id header is required", 400, "MISSING_WORKSPACE");
    });

    // GET /agents/tester — get or create the Tester agent
    fastify.get("/agents/tester", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const tester = await testerService.getOrCreateTester(workspaceId);
        return { data: tester };
    });

    // GET /testing/suites — list all test suites
    fastify.get("/testing/suites", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { agentId } = request.query as { agentId?: string };

        if (agentId) {
            const suites = await testSuiteRepository.findByAgent(agentId, workspaceId);
            const withStats = await Promise.all(
                suites.map(async (s) => ({
                    ...s,
                    stats: await testCaseRepository.getStatsForSuite(s.id, workspaceId),
                }))
            );
            return { data: withStats };
        }

        const rows = await testSuiteRepository.findByWorkspace(workspaceId);
        const withStats = await Promise.all(
            rows.map(async (r) => ({
                ...r.suite,
                agent: r.agent,
                stats: await testCaseRepository.getStatsForSuite(r.suite.id, workspaceId),
            }))
        );
        return { data: withStats };
    });

    // GET /testing/suites/:id — get suite with all cases
    fastify.get("/testing/suites/:id", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };

        const suite = await testSuiteRepository.findByIdWithCases(id, workspaceId);
        if (!suite) throw new AppError("Test suite not found", 404, "SUITE_NOT_FOUND");

        const stats = await testCaseRepository.getStatsForSuite(id, workspaceId);
        return { data: { ...suite, stats } };
    });

    // DELETE /testing/suites/:id — delete suite
    fastify.delete("/testing/suites/:id", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        const suite = await testSuiteRepository.delete(id, workspaceId);
        if (!suite) throw new AppError("Test suite not found", 404, "SUITE_NOT_FOUND");
        return reply.status(204).send();
    });

    // GET /testing/agents/:agentId/stats — get test stats for an agent
    fastify.get("/testing/agents/:agentId/stats", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { agentId } = request.params as { agentId: string };
        const stats = await testCaseRepository.getStatsForAgent(agentId, workspaceId);
        return { data: stats };
    });
}
