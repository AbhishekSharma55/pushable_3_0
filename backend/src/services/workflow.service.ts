import { workflowRepository } from "../repositories/workflow.repository.ts";
import { workflowRunRepository } from "../repositories/workflow-run.repository.ts";
import { NotFoundError } from "../lib/errors.ts";
import { compileTraceToRecipe } from "../lib/workflow-compiler.ts";
import { executeWorkflow } from "../processors/workflow.processor.ts";
import { checkCredits, deductCredits, calculateCreditCost } from "../lib/credit-engine.ts";
import { logger } from "../lib/logger.ts";
import { db } from "../db/client.ts";
import { messages } from "../db/schema/index.ts";
import { eq, asc } from "drizzle-orm";
import type { WorkflowRecipe } from "../lib/workflow-compiler.ts";
import type { TraceStep } from "../graphs/agent.graph.ts";

export const workflowService = {
    async createWorkflow(
        data: {
            agentId: string;
            name: string;
            description?: string;
            inputSchema?: Record<string, unknown>;
            recipe?: Record<string, unknown>;
            sourceSessionId?: string;
            enabled?: boolean;
        },
        workspaceId: string
    ) {
        return workflowRepository.create({
            ...data,
            workspaceId,
        });
    },

    async getWorkflows(workspaceId: string) {
        return workflowRepository.findByWorkspace(workspaceId);
    },

    async getWorkflow(id: string, workspaceId: string) {
        const workflow = await workflowRepository.findById(id, workspaceId);
        if (!workflow) throw new NotFoundError("Workflow not found");
        return workflow;
    },

    async updateWorkflow(
        id: string,
        workspaceId: string,
        data: Partial<{
            name: string;
            description: string;
            inputSchema: Record<string, unknown>;
            recipe: Record<string, unknown>;
            enabled: boolean;
        }>
    ) {
        const workflow = await workflowRepository.findById(id, workspaceId);
        if (!workflow) throw new NotFoundError("Workflow not found");
        return workflowRepository.update(id, workspaceId, data);
    },

    async deleteWorkflow(id: string, workspaceId: string) {
        const workflow = await workflowRepository.findById(id, workspaceId);
        if (!workflow) throw new NotFoundError("Workflow not found");
        await workflowRepository.delete(id, workspaceId);
    },

    async compileFromSession(
        sessionId: string,
        agentId: string,
        workspaceId: string,
        userHint?: string
    ) {
        // Fetch messages for the session and extract execution trace
        const sessionMessages = await db
            .select()
            .from(messages)
            .where(eq(messages.sessionId, sessionId))
            .orderBy(asc(messages.createdAt));

        // Extract execution traces from message metadata
        const trace: TraceStep[] = [];
        for (const msg of sessionMessages) {
            const meta = msg.metadata as Record<string, unknown> | null;
            if (meta?.execution_trace && Array.isArray(meta.execution_trace)) {
                trace.push(...(meta.execution_trace as TraceStep[]));
            }
        }

        if (trace.length < 2) {
            // Fallback: extract from tool call metadata
            for (const msg of sessionMessages) {
                const meta = msg.metadata as Record<string, unknown> | null;
                if (meta?.toolCalls && Array.isArray(meta.toolCalls)) {
                    for (const tc of meta.toolCalls as Array<{ name: string; args: Record<string, unknown>; result?: string; status?: string }>) {
                        if (tc.status === "done" || tc.result) {
                            trace.push({
                                tool: tc.name,
                                args: tc.args || {},
                                output: (tc.result || "").slice(0, 2000),
                                durationMs: 0,
                                succeeded: true,
                                timestamp: new Date().toISOString(),
                            });
                        }
                    }
                }
            }
        }

        if (trace.length < 2) {
            throw new NotFoundError("Not enough tool calls found in this session to compile a workflow. Need at least 2 successful tool calls.");
        }

        // Compile trace to recipe
        const compiled = await compileTraceToRecipe({ trace, userHint });

        // Save as workflow
        const workflow = await workflowRepository.create({
            workspaceId,
            agentId,
            name: compiled.name,
            description: compiled.description,
            inputSchema: compiled.inputSchema as Record<string, unknown>,
            recipe: compiled.recipe as unknown as Record<string, unknown>,
            sourceSessionId: sessionId,
        });

        return workflow;
    },

    async runWorkflow(
        workflowId: string,
        workspaceId: string,
        inputData: Record<string, unknown>
    ) {
        const workflow = await workflowRepository.findById(workflowId, workspaceId);
        if (!workflow) throw new NotFoundError("Workflow not found");

        const recipe = workflow.recipe as unknown as WorkflowRecipe;
        if (!recipe?.steps?.length) {
            throw new NotFoundError("Workflow has no steps");
        }

        // Check credits
        const estimatedCost = calculateCreditCost({
            action: "workflow_run",
            stepCount: recipe.steps.length,
        });
        const creditCheck = await checkCredits(workspaceId, estimatedCost);
        if (!creditCheck.allowed) {
            throw new Error(`Insufficient credits: ${creditCheck.reason}`);
        }

        // Create run record
        const run = await workflowRunRepository.create({
            workflowId,
            workspaceId,
            inputData,
        });

        try {
            const result = await executeWorkflow({
                workflowId,
                workspaceId,
                agentId: workflow.agentId,
                inputData,
                recipe,
            });

            await workflowRunRepository.updateCompleted(run.id, {
                resultText: result.resultText,
                creditsUsed: result.creditsUsed,
                durationMs: result.durationMs,
                stepResults: result.stepResults,
            });

            await deductCredits({
                workspaceId,
                amount: result.creditsUsed,
                type: "workflow_run",
                metadata: { workflowId, agentId: workflow.agentId },
            });

            await workflowRepository.updateLastRunAt(workflowId);
            await workflowRepository.incrementRunCount(workflowId);

            return {
                ...run,
                status: "completed" as const,
                resultText: result.resultText,
                creditsUsed: result.creditsUsed,
                durationMs: result.durationMs,
                stepResults: result.stepResults,
            };
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : "Unknown error";
            const durationMs = Date.now() - run.startedAt.getTime();
            await workflowRunRepository.updateFailed(run.id, errMsg, durationMs);
            logger.error({ workflowId, error: errMsg }, "Workflow execution failed");
            throw error;
        }
    },

    async getWorkflowRuns(
        workflowId: string,
        workspaceId: string,
        limit: number,
        offset: number
    ) {
        return workflowRunRepository.findByWorkflow(workflowId, workspaceId, limit, offset);
    },

    async getWorkflowStats(workflowId: string, workspaceId: string) {
        return workflowRunRepository.getStats(workflowId, workspaceId);
    },
};
