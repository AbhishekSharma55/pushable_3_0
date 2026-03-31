import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { workflowRepository } from "../repositories/workflow.repository.ts";
import { workflowRunRepository } from "../repositories/workflow-run.repository.ts";
import { executeWorkflow } from "../processors/workflow.processor.ts";
import { compileTraceToRecipe } from "../lib/workflow-compiler.ts";
import { checkCredits, deductCredits, calculateCreditCost } from "../lib/credit-engine.ts";
import type { TraceStep } from "../graphs/agent.graph.ts";
import type { WorkflowRecipe } from "../lib/workflow-compiler.ts";
import { logger } from "../lib/logger.ts";

interface WorkflowToolsConfig {
    workspaceId: string;
    agentId: string;
    getTrace: () => TraceStep[];
}

export function buildWorkflowTools(config: WorkflowToolsConfig): DynamicStructuredTool[] {
    const { workspaceId, agentId, getTrace } = config;
    const tools: DynamicStructuredTool[] = [];

    // --- list_workflows ---
    tools.push(
        new DynamicStructuredTool({
            name: "list_workflows",
            description: "List all saved workflow recipes available for this agent. Workflows are compiled processes that can be replayed efficiently without full LLM reasoning.",
            schema: z.object({}),
            func: async () => {
                const workflows = await workflowRepository.findByAgent(agentId, workspaceId);
                if (workflows.length === 0) {
                    return "No workflows saved yet. You can save the current process as a workflow using the save_as_workflow tool.";
                }
                const list = workflows.map(w => {
                    const recipe = w.recipe as WorkflowRecipe;
                    const stepCount = recipe?.steps?.length ?? 0;
                    const inputSchema = w.inputSchema as Record<string, unknown> | null;
                    const inputParams = inputSchema && Object.keys(inputSchema).length > 0
                        ? `\n  Required inputs: ${JSON.stringify(inputSchema)}`
                        : "\n  Required inputs: none";
                    return `- ${w.name} (ID: ${w.id}) — ${w.description || "No description"} — ${stepCount} steps — ${w.enabled ? "enabled" : "disabled"} — run ${w.runCount} times${inputParams}`;
                }).join("\n");
                return `Available workflows:\n${list}\n\nTo run a workflow, call run_workflow with workflowName (the exact name above) and pass the required inputs in inputData. Example: run_workflow({ workflowName: "${workflows[0].name}", inputData: { ... } })`;
            },
        })
    );

    // --- run_workflow ---
    tools.push(
        new DynamicStructuredTool({
            name: "run_workflow",
            description: "Execute a saved workflow recipe with the given input parameters. This runs the workflow's tool calls directly without full LLM reasoning, making it much faster and cheaper than running the process manually. You can identify the workflow by name (preferred) or by ID.",
            schema: z.object({
                workflowName: z.string().optional().describe("Name of the workflow to execute (preferred — use the exact name from list_workflows)"),
                workflowId: z.string().uuid().optional().describe("ID of the workflow to execute (alternative to workflowName)"),
                inputData: z.record(z.string(), z.unknown()).optional().default({}).describe("Input parameters for the workflow (keys must match the workflow's inputSchema)"),
            }),
            func: async ({ workflowName, workflowId, inputData }) => {
                if (!workflowName && !workflowId) {
                    return "Error: You must provide either workflowName or workflowId to run a workflow.";
                }

                // Look up by name first (preferred), then by ID
                let workflow;
                if (workflowName) {
                    workflow = await workflowRepository.findByName(workflowName, agentId, workspaceId);
                    if (!workflow) return `Workflow with name "${workflowName}" not found. Use list_workflows to see available workflows.`;
                } else {
                    workflow = await workflowRepository.findById(workflowId!, workspaceId);
                    if (!workflow) return `Workflow with ID "${workflowId}" not found. Use list_workflows to see available workflows.`;
                }

                if (!workflow.enabled) return `Workflow "${workflow.name}" is disabled.`;

                const recipe = workflow.recipe as WorkflowRecipe;
                if (!recipe?.steps?.length) return `Workflow "${workflow.name}" has no steps.`;

                // Check credits
                const estimatedCost = calculateCreditCost({
                    action: "workflow_run",
                    stepCount: recipe.steps.length,
                });
                const creditCheck = await checkCredits(workspaceId, estimatedCost);
                if (!creditCheck.allowed) {
                    return `Insufficient credits to run workflow. Estimated cost: ${estimatedCost} credits. Reason: ${creditCheck.reason}`;
                }

                // Create run record
                const resolvedWorkflowId = workflow.id;
                const run = await workflowRunRepository.create({
                    workflowId: resolvedWorkflowId,
                    workspaceId,
                    inputData: inputData as Record<string, unknown>,
                });

                const runStartMs = Date.now();
                try {
                    const result = await executeWorkflow({
                        workflowId: resolvedWorkflowId,
                        workspaceId,
                        agentId: workflow.agentId,
                        inputData: inputData as Record<string, unknown>,
                        recipe,
                    });

                    // Update run record
                    await workflowRunRepository.updateCompleted(run.id, {
                        resultText: result.resultText,
                        creditsUsed: result.creditsUsed,
                        durationMs: result.durationMs,
                        stepResults: result.stepResults,
                    });

                    // Deduct credits
                    await deductCredits({
                        workspaceId,
                        amount: result.creditsUsed,
                        type: "workflow_run",
                        metadata: { workflowId: resolvedWorkflowId, agentId: workflow.agentId },
                    });

                    // Update workflow stats
                    await workflowRepository.updateLastRunAt(resolvedWorkflowId);
                    await workflowRepository.incrementRunCount(resolvedWorkflowId);

                    // Build detailed step-by-step report so the agent knows exactly what the workflow did
                    const stepReport = result.stepResults.map((sr, i) => {
                        const status = sr.skipped ? "SKIPPED" : sr.succeeded ? "OK" : "FAILED";
                        const label = sr.tool ? sr.tool : "nano_llm";
                        const outputPreview = sr.output.length > 800 ? sr.output.slice(0, 800) + "..." : sr.output;
                        return `  Step ${i + 1} [${label}]: ${status}\n  Output: ${outputPreview}`;
                    }).join("\n\n");

                    const allSucceeded = result.stepResults.every(sr => sr.succeeded || sr.skipped);

                    return (
                        `Workflow "${workflow.name}" completed ${allSucceeded ? "successfully" : "with errors"} in ${result.durationMs}ms (${result.creditsUsed} credits).\n\n` +
                        `Steps executed:\n${stepReport}\n\n` +
                        `IMPORTANT: The workflow has already executed all the steps above. Do NOT repeat these actions manually. ` +
                        `Use the step outputs above to answer the user. If the workflow succeeded, the task is done.`
                    );
                } catch (error) {
                    const errMsg = error instanceof Error ? error.message : "Unknown error";
                    await workflowRunRepository.updateFailed(run.id, errMsg, Date.now() - runStartMs);
                    return `Workflow "${workflow.name}" failed: ${errMsg}`;
                }
            },
        })
    );

    // --- save_as_workflow ---
    tools.push(
        new DynamicStructuredTool({
            name: "save_as_workflow",
            description: "Compile the tool calls from this conversation into a reusable workflow recipe. The workflow can then be replayed cheaply without full LLM reasoning. Use this after successfully completing a multi-step process that the user might want to repeat.",
            schema: z.object({
                name: z.string().describe("Short name for the workflow"),
                description: z.string().optional().describe("Description of what the workflow does"),
                userHint: z.string().optional().describe("Hint about which arguments should be parameterized (e.g. 'the URL and product name should be inputs')"),
            }),
            func: async ({ name, description, userHint }) => {
                const trace = getTrace();
                if (!trace || trace.length === 0) {
                    return "No tool calls recorded in this conversation yet. Execute some tools first, then save as a workflow.";
                }

                const successfulSteps = trace.filter(s => s.succeeded);
                if (successfulSteps.length < 2) {
                    return "Need at least 2 successful tool calls to create a meaningful workflow. Execute more tools first.";
                }

                try {
                    const compiled = await compileTraceToRecipe({
                        trace,
                        userHint,
                    });

                    const workflow = await workflowRepository.create({
                        workspaceId,
                        agentId,
                        name: name || compiled.name,
                        description: description || compiled.description,
                        inputSchema: compiled.inputSchema as Record<string, unknown>,
                        recipe: compiled.recipe as unknown as Record<string, unknown>,
                    });

                    const paramCount = Object.keys(compiled.inputSchema).length;
                    const stepCount = compiled.recipe.steps.length;

                    return `Workflow "${workflow.name}" saved successfully!\n- ID: ${workflow.id}\n- ${stepCount} steps\n- ${paramCount} input parameters: ${Object.keys(compiled.inputSchema).join(", ") || "none"}\n\nThe user can now run this workflow from the Workflows page, or you can run it with the run_workflow tool.`;
                } catch (error) {
                    logger.error({ error, traceLegth: trace.length }, "Failed to compile workflow");
                    return `Failed to compile workflow: ${error instanceof Error ? error.message : "Unknown error"}`;
                }
            },
        })
    );

    return tools;
}
