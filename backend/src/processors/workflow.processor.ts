import { getToolsForAgent } from "../graphs/agent.graph.ts";
import { createLLM } from "../lib/gateway.ts";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { logger } from "../lib/logger.ts";
import type { WorkflowRecipe, WorkflowStep, ToolStep, NanoLLMStep } from "../lib/workflow-compiler.ts";

const NANO_MODEL = "openai/gpt-4.1-nano";

export interface StepResult {
    stepId: string;
    tool?: string;
    type: "tool" | "nano_llm";
    output: string;
    durationMs: number;
    succeeded: boolean;
    skipped?: boolean;
    error?: string;
}

interface ExecutionContext {
    input: Record<string, unknown>;
    steps: Record<string, { output: string; parsed?: unknown }>;
}

// --- Placeholder Resolution ---

function resolvePlaceholders(value: unknown, context: ExecutionContext): unknown {
    if (typeof value === "string") {
        return resolveStringPlaceholders(value, context);
    }
    if (Array.isArray(value)) {
        return value.map(v => resolvePlaceholders(v, context));
    }
    if (value !== null && typeof value === "object") {
        const resolved: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) {
            resolved[k] = resolvePlaceholders(v, context);
        }
        return resolved;
    }
    return value;
}

function resolveStringPlaceholders(template: string, context: ExecutionContext): string {
    return template.replace(/\{\{([^}]+)\}\}/g, (_match, path: string) => {
        const trimmed = path.trim();

        // {{input.xxx}}
        if (trimmed.startsWith("input.")) {
            const key = trimmed.slice(6);
            const val = context.input[key];
            return val !== undefined ? String(val) : "";
        }

        // {{steps.step_N.output}}
        if (trimmed.startsWith("steps.")) {
            const parts = trimmed.slice(6).split(".");
            const stepId = parts[0];
            const stepData = context.steps[stepId];
            if (!stepData) return "";

            if (parts[1] === "output") {
                return stepData.output;
            }

            // {{steps.step_N.parsed.field}}
            if (parts[1] === "parsed" && parts[2] && stepData.parsed) {
                const parsed = stepData.parsed as Record<string, unknown>;
                return parsed[parts[2]] !== undefined ? String(parsed[parts[2]]) : "";
            }

            return stepData.output;
        }

        return "";
    });
}

// --- Condition Evaluation (safe, no eval) ---

function evaluateCondition(expression: string, context: ExecutionContext): boolean {
    const trimmed = expression.trim();
    if (!trimmed) return true;

    // Handle && and || by splitting
    if (trimmed.includes("&&")) {
        return trimmed.split("&&").every(part => evaluateCondition(part.trim(), context));
    }
    if (trimmed.includes("||")) {
        return trimmed.split("||").some(part => evaluateCondition(part.trim(), context));
    }

    // Parse simple comparison: left operator right
    const operators = [">=", "<=", "!=", "==", ">", "<"];
    for (const op of operators) {
        const idx = trimmed.indexOf(op);
        if (idx === -1) continue;

        const left = resolveValue(trimmed.slice(0, idx).trim(), context);
        const right = resolveValue(trimmed.slice(idx + op.length).trim(), context);

        switch (op) {
            case ">": return Number(left) > Number(right);
            case "<": return Number(left) < Number(right);
            case ">=": return Number(left) >= Number(right);
            case "<=": return Number(left) <= Number(right);
            case "==": return String(left) === String(right);
            case "!=": return String(left) !== String(right);
        }
    }

    // Truthy check: just resolve the value
    const val = resolveValue(trimmed, context);
    return !!val && val !== "0" && val !== "false" && val !== "null" && val !== "undefined" && val !== "";
}

function resolveValue(token: string, context: ExecutionContext): string | number {
    // String literal
    if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
        return token.slice(1, -1);
    }

    // Number literal
    if (!isNaN(Number(token)) && token !== "") {
        return Number(token);
    }

    // Boolean literals
    if (token === "true") return 1;
    if (token === "false") return 0;

    // Variable reference: steps.step_N.xxx or input.xxx
    const resolved = resolveStringPlaceholders(`{{${token}}}`, context);
    return resolved;
}

// --- Step Executors ---

async function executeToolStep(
    step: ToolStep,
    context: ExecutionContext,
    toolsByName: Map<string, unknown>,
): Promise<StepResult> {
    const startMs = Date.now();
    const resolvedArgs = resolvePlaceholders(step.args, context) as Record<string, unknown>;

    const tool = toolsByName.get(step.tool) as { invoke: (args: unknown) => Promise<unknown> } | undefined;
    if (!tool) {
        return {
            stepId: step.id,
            tool: step.tool,
            type: "tool",
            output: `Tool "${step.tool}" not found`,
            durationMs: Date.now() - startMs,
            succeeded: false,
            error: `Tool "${step.tool}" not found`,
        };
    }

    try {
        const result = await tool.invoke(resolvedArgs);
        const output = typeof result === "string" ? result : JSON.stringify(result);
        return {
            stepId: step.id,
            tool: step.tool,
            type: "tool",
            output,
            durationMs: Date.now() - startMs,
            succeeded: true,
        };
    } catch (error) {
        const errMsg = error instanceof Error ? error.message : "Unknown error";
        return {
            stepId: step.id,
            tool: step.tool,
            type: "tool",
            output: errMsg,
            durationMs: Date.now() - startMs,
            succeeded: false,
            error: errMsg,
        };
    }
}

async function executeNanoLLMStep(
    step: NanoLLMStep,
    context: ExecutionContext,
): Promise<StepResult> {
    const startMs = Date.now();
    const resolvedPrompt = resolveStringPlaceholders(step.prompt, context);

    try {
        const { llm } = createLLM({
            modelId: NANO_MODEL,
            temperature: 0.3,
            streaming: false,
        });

        const response = await llm.invoke([
            new SystemMessage("You are a data transformation assistant. Extract or transform the data as instructed. Return only the requested output, nothing else."),
            new HumanMessage(resolvedPrompt),
        ]);

        const output = typeof response.content === "string"
            ? response.content
            : JSON.stringify(response.content);

        return {
            stepId: step.id,
            type: "nano_llm",
            output,
            durationMs: Date.now() - startMs,
            succeeded: true,
        };
    } catch (error) {
        const errMsg = error instanceof Error ? error.message : "Unknown error";
        return {
            stepId: step.id,
            type: "nano_llm",
            output: errMsg,
            durationMs: Date.now() - startMs,
            succeeded: false,
            error: errMsg,
        };
    }
}

// --- Main Executor ---

export async function executeWorkflow(params: {
    workflowId: string;
    workspaceId: string;
    agentId: string;
    inputData: Record<string, unknown>;
    recipe: WorkflowRecipe;
}): Promise<{
    resultText: string;
    creditsUsed: number;
    durationMs: number;
    stepResults: StepResult[];
}> {
    const { workspaceId, agentId, inputData, recipe } = params;
    const startTime = Date.now();

    logger.info({
        workflowId: params.workflowId,
        agentId,
        stepCount: recipe.steps.length,
    }, "Executing workflow recipe");

    // Load tools for this agent
    const toolsByName = await getToolsForAgent(agentId, workspaceId);

    const context: ExecutionContext = {
        input: inputData,
        steps: {},
    };

    const stepResults: StepResult[] = [];
    let lastOutput = "";

    for (const step of recipe.steps) {
        // Evaluate condition if present
        if (step.condition) {
            const shouldRun = evaluateCondition(step.condition, context);
            if (!shouldRun) {
                stepResults.push({
                    stepId: step.id,
                    type: step.type,
                    tool: step.type === "tool" ? (step as ToolStep).tool : undefined,
                    output: "Skipped (condition not met)",
                    durationMs: 0,
                    succeeded: true,
                    skipped: true,
                });
                continue;
            }
        }

        let result: StepResult;

        if (step.type === "tool") {
            result = await executeToolStep(step as ToolStep, context, toolsByName);
        } else {
            result = await executeNanoLLMStep(step as NanoLLMStep, context);
        }

        stepResults.push(result);

        if (result.succeeded) {
            // Store output for later steps
            const stepData: { output: string; parsed?: unknown } = { output: result.output };

            // Try to parse as JSON for structured access
            try {
                stepData.parsed = JSON.parse(result.output);
            } catch {
                // Not JSON, that's fine
            }

            context.steps[step.id] = stepData;
            lastOutput = result.output;
        } else {
            // Handle failure
            const toolStep = step as ToolStep;
            if (toolStep.continueOnError) {
                context.steps[step.id] = { output: result.error || "Error" };
                continue;
            }

            if (toolStep.fallbackToAgent) {
                logger.warn({ stepId: step.id, error: result.error }, "Step failed, fallback to agent not yet implemented");
            }

            // Stop execution on failure (unless continueOnError)
            logger.error({ stepId: step.id, error: result.error }, "Workflow step failed, stopping execution");
            break;
        }
    }

    const durationMs = Date.now() - startTime;
    const successfulSteps = stepResults.filter(r => r.succeeded && !r.skipped).length;

    // Credit cost: 2 per tool step + 4 per nano_llm step
    const toolStepCount = stepResults.filter(r => r.type === "tool" && r.succeeded && !r.skipped).length;
    const llmStepCount = stepResults.filter(r => r.type === "nano_llm" && r.succeeded && !r.skipped).length;
    const creditsUsed = (toolStepCount * 2) + (llmStepCount * 4);

    logger.info({
        workflowId: params.workflowId,
        totalSteps: recipe.steps.length,
        successfulSteps,
        durationMs,
        creditsUsed,
    }, "Workflow execution completed");

    return {
        resultText: lastOutput || "Workflow completed with no output",
        creditsUsed: Math.max(1, creditsUsed),
        durationMs,
        stepResults,
    };
}
