import type { FastifyInstance } from "fastify";
import { eq, asc } from "drizzle-orm";
import { db } from "../db/client.ts";
import { llmModels } from "../db/schema/index.ts";
import { UnauthorizedError } from "../lib/errors.ts";
import { isPlanSufficient, BASE_CREDIT_COSTS } from "../lib/credit-engine.ts";
import { isClaudeGateway } from "../lib/gateway.ts";

// For now, workspace plan is always "pro" (no subscription system yet).
// Replace this when plan system is implemented.
function getWorkspacePlan(_workspaceId: string): string {
    return "pro";
}

export async function modelRoutes(fastify: FastifyInstance) {
    fastify.addHook("onRequest", async (request) => {
        try {
            await request.jwtVerify();
        } catch {
            throw new UnauthorizedError("Invalid or expired token");
        }
    });

    // GET /models — returns models available on workspace plan
    fastify.get("/models", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const plan = getWorkspacePlan(workspaceId);
        const claudeDirectEnabled = isClaudeGateway();

        const allModels = await db
            .select()
            .from(llmModels)
            .where(eq(llmModels.isActive, true))
            .orderBy(asc(llmModels.sortOrder));

        const available = allModels.filter((m) =>
            isPlanSufficient(plan, m.minimumPlan)
        );

        return {
            data: available.map((m) => ({
                id: m.id,
                provider: m.provider,
                modelId: m.modelId,
                displayName: m.displayName,
                description: m.description,
                multiplier: Number(m.multiplier),
                contextWindow: m.contextWindow,
                minimumPlan: m.minimumPlan,
                isFeatured: m.isFeatured,
                directApiEnabled: m.provider === "anthropic" && claudeDirectEnabled,
                creditCostPerMessage: Math.ceil(
                    BASE_CREDIT_COSTS.CHAT_MESSAGE_BASE * Number(m.multiplier)
                ),
            })),
        };
    });

    // GET /models/all — returns all models with availability info
    fastify.get("/models/all", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const plan = getWorkspacePlan(workspaceId);
        const claudeDirectEnabled = isClaudeGateway();

        const allModels = await db
            .select()
            .from(llmModels)
            .where(eq(llmModels.isActive, true))
            .orderBy(asc(llmModels.sortOrder));

        return {
            data: allModels.map((m) => ({
                id: m.id,
                provider: m.provider,
                modelId: m.modelId,
                displayName: m.displayName,
                description: m.description,
                multiplier: Number(m.multiplier),
                contextWindow: m.contextWindow,
                minimumPlan: m.minimumPlan,
                isFeatured: m.isFeatured,
                available: isPlanSufficient(plan, m.minimumPlan),
                requiredPlan: m.minimumPlan,
                directApiEnabled: m.provider === "anthropic" && claudeDirectEnabled,
                creditCostPerMessage: Math.ceil(
                    BASE_CREDIT_COSTS.CHAT_MESSAGE_BASE * Number(m.multiplier)
                ),
            })),
        };
    });
}
