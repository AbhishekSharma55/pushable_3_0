import { createLLM } from "./gateway.ts";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { logger } from "./logger.ts";
import type { TraceStep } from "../graphs/agent.graph.ts";

export interface WorkflowInputSchema {
    [param: string]: {
        type: "string" | "number" | "boolean";
        description: string;
        required?: boolean;
        default?: string | number | boolean;
    };
}

export interface ToolStep {
    id: string;
    type: "tool";
    tool: string;
    args: Record<string, unknown>;
    outputKey: string;
    condition?: string;
    fallbackToAgent?: boolean;
    continueOnError?: boolean;
    description?: string;
}

export interface NanoLLMStep {
    id: string;
    type: "nano_llm";
    prompt: string;
    outputKey: string;
    condition?: string;
    description?: string;
}

export type WorkflowStep = ToolStep | NanoLLMStep;

export interface WorkflowRecipe {
    version: 1;
    steps: WorkflowStep[];
    outputTemplate?: string;
}

export interface CompileOutput {
    name: string;
    description: string;
    inputSchema: WorkflowInputSchema;
    recipe: WorkflowRecipe;
}

const COMPILE_SYSTEM_PROMPT = `You are a workflow compiler. You analyze a sequence of tool calls (an execution trace) and produce a reusable, parameterized workflow recipe in JSON.

Your job:
1. Analyze the trace steps — each has a tool name, args, output, and whether it succeeded.
2. Identify which arguments are VARIABLE (would change per run) vs CONSTANT (same every time).
3. Variable arguments become \`{{input.paramName}}\` placeholders. Choose clear, descriptive parameter names.
4. When one step's output feeds into another step's args, use \`{{steps.step_N.output}}\` references.
5. If data transformation is needed between steps (e.g., extracting a URL from a search result), insert a \`nano_llm\` glue step with a clear prompt.
6. Skip failed steps unless they were later retried successfully.
7. Generate a concise name and description for the workflow.

Output ONLY valid JSON matching this exact schema:
{
  "name": "string — short workflow name",
  "description": "string — what this workflow does",
  "inputSchema": {
    "paramName": {
      "type": "string" | "number" | "boolean",
      "description": "what this parameter is",
      "required": true | false
    }
  },
  "recipe": {
    "version": 1,
    "steps": [
      // Tool step:
      { "id": "step_1", "type": "tool", "tool": "tool_name", "args": { "key": "value or {{input.param}} or {{steps.step_N.output}}" }, "outputKey": "step_1_output", "description": "what this step does" },
      // Nano LLM glue step:
      { "id": "step_2", "type": "nano_llm", "prompt": "Extract the price from: {{steps.step_1.output}}", "outputKey": "step_2_output", "description": "what this extraction does" }
    ]
  }
}

Rules:
- Each step MUST have a unique id (step_1, step_2, ...) and an outputKey.
- Only use tool names that appear in the trace.
- Make the inputSchema minimal — only parameters the user needs to provide.
- Do NOT include steps that consistently failed.
- Output ONLY the JSON object, no markdown fences or explanation.`;

export async function compileTraceToRecipe(input: {
    trace: TraceStep[];
    userHint?: string;
}): Promise<CompileOutput> {
    const { trace, userHint } = input;

    const successfulSteps = trace.filter(s => s.succeeded);
    if (successfulSteps.length === 0) {
        throw new Error("No successful tool calls found in execution trace");
    }

    const traceDescription = successfulSteps
        .map((s, i) => `Step ${i + 1}: tool="${s.tool}", args=${JSON.stringify(s.args)}, output="${s.output.slice(0, 500)}"`)
        .join("\n");

    const userMessage = userHint
        ? `Execution trace:\n${traceDescription}\n\nUser's description of this workflow: ${userHint}`
        : `Execution trace:\n${traceDescription}`;

    const { llm } = createLLM({
        modelId: "openai/gpt-4o-mini",
        temperature: 0.2,
        streaming: false,
    });

    const response = await llm.invoke([
        new SystemMessage(COMPILE_SYSTEM_PROMPT),
        new HumanMessage(userMessage),
    ]);

    const content = typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    // Extract JSON object from response — handle markdown fences, trailing text, etc.
    const jsonStr = extractJSON(content);

    try {
        const parsed = JSON.parse(jsonStr) as CompileOutput;

        // Validate basic structure
        if (!parsed.name || !parsed.recipe || !Array.isArray(parsed.recipe.steps)) {
            throw new Error("Invalid recipe structure");
        }

        // Ensure version is set
        parsed.recipe.version = 1;

        return parsed;
    } catch (error) {
        logger.error({ error, content: content.slice(0, 500) }, "Failed to parse compiled recipe");
        throw new Error(`Failed to compile workflow: ${error instanceof Error ? error.message : "Invalid JSON response"}`);
    }
}

/** Extract the first complete JSON object from a string, handling fences and trailing text. */
function extractJSON(text: string): string {
    // Strip markdown code fences
    let cleaned = text.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();

    // Find the first '{' and match to its closing '}'
    const start = cleaned.indexOf("{");
    if (start === -1) throw new Error("No JSON object found in response");

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = start; i < cleaned.length; i++) {
        const ch = cleaned[i];

        if (escape) {
            escape = false;
            continue;
        }

        if (ch === "\\") {
            escape = true;
            continue;
        }

        if (ch === '"') {
            inString = !inString;
            continue;
        }

        if (inString) continue;

        if (ch === "{") depth++;
        else if (ch === "}") {
            depth--;
            if (depth === 0) {
                return cleaned.slice(start, i + 1);
            }
        }
    }

    // Fallback: return from first { to end
    return cleaned.slice(start);
}
