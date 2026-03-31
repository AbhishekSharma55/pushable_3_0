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

/** Model used for workflow compilation — a one-time cost per workflow, so quality matters more than price. */
const COMPILER_MODEL = "openai/gpt-5.4-mini";

const COMPILE_SYSTEM_PROMPT = `You are a workflow compiler. You analyze a sequence of tool calls (an execution trace) and produce a reusable, parameterized workflow recipe in JSON.

Your job:
1. Analyze the trace steps — each has a tool name, args, output, and whether it succeeded.
2. Identify which arguments are VARIABLE (would change per run) vs CONSTANT (same every time).
3. Variable arguments become \`{{input.paramName}}\` placeholders. Choose clear, descriptive parameter names.
4. When one step's output feeds into another step's args, use \`{{steps.step_N.output}}\` references.
5. If data transformation is needed between steps (e.g., extracting a value from text output), insert a \`nano_llm\` glue step with a clear, explicit prompt that tells the nano model exactly what to extract and how to format it.
6. Skip failed steps unless they were later retried successfully.
7. Remove duplicate or redundant steps (e.g., if the same tool was called twice with the same args, keep only one).
8. Generate a concise name and description for the workflow.

Output ONLY valid JSON matching this exact schema:
{
  "name": "string — short snake_case workflow name",
  "description": "string — what this workflow does, mentioning key tools and data it touches",
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
      { "id": "step_1", "type": "tool", "tool": "tool_name", "args": { "key": "value or {{input.param}} or {{steps.step_N.output}}" }, "outputKey": "step_1_output", "description": "what this step does" },
      { "id": "step_2", "type": "nano_llm", "prompt": "Extract the price from: {{steps.step_1.output}}", "outputKey": "step_2_output", "description": "what this extraction does" }
    ]
  }
}

## Rules
- Each step MUST have a unique id (step_1, step_2, ...) and an outputKey.
- Only use tool names that appear in the trace.
- Make the inputSchema minimal — only parameters the user needs to provide.
- Do NOT include steps that consistently failed.
- Output ONLY the JSON object, no markdown fences or explanation.

## nano_llm Step Guidelines
nano_llm steps run on a very small, fast language model. Their prompts MUST be:
- **Explicit**: Tell it exactly what to look for and what format to return. Don't be vague.
- **Self-contained**: Include all necessary context in the prompt via {{steps.step_N.output}} references.
- **Focused**: One extraction/transformation per step. Don't ask it to do multiple things.
- **Example-driven**: When possible, include a brief example of the expected output format.

BAD nano_llm prompt: "Process the data"
BAD nano_llm prompt: "Please provide the data or specify the transformation you need."
GOOD nano_llm prompt: "From the CSV data below, find the row where the Name column contains '{{input.patientName}}' and return ONLY the Patient_ID value (e.g. 'P-1001'). Data:\\n{{steps.step_1.output}}"
GOOD nano_llm prompt: "From the billing CSV below, find the highest Billing_ID number (format: B-NNNN) and return the next ID. Example: if highest is B-5016, return B-5017.\\nData:\\n{{steps.step_2.output}}"

## Example

Trace:
  Step 1: tool="bucket_read_file", args={"filename":"patients.csv","folder":"/shared/healthcare"}, output="Patient_ID,Name,...\\nP-1001,Sarah Johnson..."
  Step 2: tool="bucket_read_file", args={"filename":"billing.csv","folder":"/shared/healthcare"}, output="Billing_ID,Patient_ID,...\\nB-5001,P-1001..."
  Step 3: tool="bucket_append_csv", args={"filename":"billing.csv","folder":"/shared/healthcare","row":"B-5017,P-1009,Abhishek Sharma,,Ayurvedic Painkiller,,22.0,..."}, output="Row appended"

Compiled recipe:
{
  "name": "create_patient_billing",
  "description": "Creates a new patient invoice by looking up the Patient ID in patients.csv and appending a new billing record to billing.csv with an auto-incremented Billing ID.",
  "inputSchema": {
    "patientName": { "type": "string", "description": "Full name of the patient", "required": true },
    "service": { "type": "string", "description": "Name of the service/treatment", "required": true },
    "amount": { "type": "number", "description": "Invoice amount in dollars", "required": true }
  },
  "recipe": {
    "version": 1,
    "steps": [
      { "id": "step_1", "type": "tool", "tool": "bucket_read_file", "args": { "filename": "patients.csv", "folder": "/shared/healthcare" }, "outputKey": "patients_csv", "description": "Read patients.csv to find patient ID" },
      { "id": "step_2", "type": "nano_llm", "prompt": "From the CSV data below, find the row where the Name column contains '{{input.patientName}}' and return ONLY the Patient_ID value (e.g. 'P-1001'). If not found, return 'NOT_FOUND'.\\nData:\\n{{steps.step_1.output}}", "outputKey": "patient_id", "description": "Extract patient ID from CSV" },
      { "id": "step_3", "type": "tool", "tool": "bucket_read_file", "args": { "filename": "billing.csv", "folder": "/shared/healthcare" }, "outputKey": "billing_csv", "description": "Read billing.csv to find last billing ID" },
      { "id": "step_4", "type": "nano_llm", "prompt": "From the billing CSV below, find the highest Billing_ID (format: B-NNNN, a number after B-). Return ONLY the next Billing_ID. Example: if highest is B-5016, return B-5017.\\nData:\\n{{steps.step_3.output}}", "outputKey": "next_billing_id", "description": "Calculate next billing ID" },
      { "id": "step_5", "type": "tool", "tool": "bucket_append_csv", "args": { "filename": "billing.csv", "folder": "/shared/healthcare", "row": "{{steps.step_4.output}},{{steps.step_2.output}},{{input.patientName}},,{{input.service}},,{{input.amount}},0,0,0,0,Pending,Unpaid" }, "outputKey": "append_result", "description": "Append new billing record" }
    ]
  }
}`;

export async function compileTraceToRecipe(input: {
    trace: TraceStep[];
    userHint?: string;
}): Promise<CompileOutput> {
    const { trace, userHint } = input;

    const successfulSteps = trace.filter(s => s.succeeded);
    if (successfulSteps.length === 0) {
        throw new Error("No successful tool calls found in execution trace");
    }

    // Clean up the trace: deduplicate consecutive identical tool calls,
    // remove list_workflows/save_as_workflow calls (meta-tools, not actual work),
    // and collapse repeated tool calls with same name+args
    const META_TOOLS = new Set(["list_workflows", "save_as_workflow", "run_workflow"]);
    const cleanedSteps: typeof successfulSteps = [];
    for (const step of successfulSteps) {
        if (META_TOOLS.has(step.tool)) continue;
        const prev = cleanedSteps[cleanedSteps.length - 1];
        if (prev && prev.tool === step.tool && JSON.stringify(prev.args) === JSON.stringify(step.args)) {
            continue; // Skip duplicate consecutive calls
        }
        cleanedSteps.push(step);
    }

    const stepsToCompile = cleanedSteps.length > 0 ? cleanedSteps : successfulSteps;

    const traceDescription = stepsToCompile
        .map((s, i) => `Step ${i + 1}: tool="${s.tool}", args=${JSON.stringify(s.args)}, output="${s.output.slice(0, 800)}"`)
        .join("\n");

    const userMessage = userHint
        ? `Execution trace:\n${traceDescription}\n\nUser's hint about what should be parameterized: ${userHint}`
        : `Execution trace:\n${traceDescription}`;

    const { llm } = createLLM({
        modelId: COMPILER_MODEL,
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

        // Validate each step has required fields
        for (const step of parsed.recipe.steps) {
            if (!step.id || !step.type) {
                throw new Error(`Step is missing required fields (id, type): ${JSON.stringify(step)}`);
            }
            if (step.type === "tool" && !step.tool) {
                throw new Error(`Tool step "${step.id}" is missing the "tool" field`);
            }
            if (step.type === "nano_llm" && !step.prompt) {
                throw new Error(`Nano LLM step "${step.id}" is missing the "prompt" field`);
            }
            // Ensure args defaults to empty object for tool steps
            if (step.type === "tool" && !step.args) {
                step.args = {};
            }
        }

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
