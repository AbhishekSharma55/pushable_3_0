import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { userManagementService } from "../services/userManagement.service.ts";
import { AppError, UnauthorizedError, ForbiddenError } from "../lib/errors.ts";
import { workspaceRepository } from "../repositories/workspace.repository.ts";

const updateRoleSchema = z.object({
    role: z.enum(["admin", "member"]),
});

const setCreditLimitSchema = z.object({
    creditLimit: z.number().int().min(0),
    periodEnd: z.string().datetime().nullable().optional(),
});

const setAgentAccessSchema = z.object({
    access: z.array(
        z.object({
            agentId: z.string().uuid(),
            allowed: z.boolean(),
        })
    ),
});

export async function memberRoutes(fastify: FastifyInstance) {
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

    // GET /members/me — get current user's role and credit info for this workspace
    fastify.get("/members/me", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const user = request.user as { userId: string };

        const { workspaceRepository } = await import("../repositories/workspace.repository.ts");
        const { userCreditLimitRepository } = await import("../repositories/userCreditLimit.repository.ts");

        const role = await workspaceRepository.getMemberRole(workspaceId, user.userId);
        const creditLimit = await userCreditLimitRepository.findByUser(workspaceId, user.userId);

        return {
            data: {
                role,
                creditLimit: creditLimit?.creditLimit ?? null,
                creditsUsed: creditLimit?.creditsUsed ?? null,
                creditsRemaining: creditLimit
                    ? Math.max(0, creditLimit.creditLimit - creditLimit.creditsUsed)
                    : null,
            },
        };
    });

    // GET /members — list all workspace members (owner only)
    fastify.get("/members", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const user = request.user as { userId: string };

        const role = await workspaceRepository.getMemberRole(workspaceId, user.userId);
        if (role !== "owner") {
            throw new ForbiddenError("Only the workspace owner can view members");
        }

        const members = await userManagementService.getMembers(workspaceId);
        return { data: members };
    });

    // PATCH /members/:userId/role — change member role
    fastify.patch("/members/:userId/role", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { userId } = request.params as { userId: string };
        const user = request.user as { userId: string };
        const body = updateRoleSchema.parse(request.body);

        const result = await userManagementService.updateMemberRole(
            workspaceId,
            userId,
            body.role,
            user.userId
        );
        return { data: result };
    });

    // DELETE /members/:userId — remove member from workspace
    fastify.delete("/members/:userId", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { userId } = request.params as { userId: string };
        const user = request.user as { userId: string };

        await userManagementService.removeMember(workspaceId, userId, user.userId);
        return { data: { success: true } };
    });

    // PUT /members/:userId/credit-limit — set user credit limit
    fastify.put("/members/:userId/credit-limit", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { userId } = request.params as { userId: string };
        const user = request.user as { userId: string };
        const body = setCreditLimitSchema.parse(request.body);

        const result = await userManagementService.setUserCreditLimit(
            workspaceId,
            userId,
            body.creditLimit,
            body.periodEnd ? new Date(body.periodEnd) : undefined,
            user.userId
        );
        return { data: result };
    });

    // DELETE /members/:userId/credit-limit — remove user credit limit
    fastify.delete("/members/:userId/credit-limit", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { userId } = request.params as { userId: string };
        const user = request.user as { userId: string };

        await userManagementService.removeUserCreditLimit(workspaceId, userId, user.userId);
        return { data: { success: true } };
    });

    // POST /members/:userId/credit-limit/reset — reset used credits
    fastify.post("/members/:userId/credit-limit/reset", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { userId } = request.params as { userId: string };
        const user = request.user as { userId: string };

        const result = await userManagementService.resetUserCredits(
            workspaceId,
            userId,
            user.userId
        );
        return { data: result };
    });

    // GET /members/:userId/agent-access — get user's agent access
    fastify.get("/members/:userId/agent-access", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { userId } = request.params as { userId: string };

        const access = await userManagementService.getUserAgentAccess(workspaceId, userId);
        return { data: access };
    });

    // PUT /members/:userId/agent-access — set user's agent access
    fastify.put("/members/:userId/agent-access", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { userId } = request.params as { userId: string };
        const user = request.user as { userId: string };
        const body = setAgentAccessSchema.parse(request.body);

        const result = await userManagementService.setUserAgentAccess(
            workspaceId,
            userId,
            body.access,
            user.userId
        );
        return { data: result };
    });
}
