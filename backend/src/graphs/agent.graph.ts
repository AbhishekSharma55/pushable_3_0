import { StateGraph, Annotation, MessagesAnnotation, interrupt } from "@langchain/langgraph";
import type { RunnableConfig } from "@langchain/core/runnables";
import { createLLM } from "../lib/gateway.ts";
import { SystemMessage, AIMessage, HumanMessage, RemoveMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { PostgresStore } from "@langchain/langgraph-checkpoint-postgres/store";
import { OpenAIEmbeddings } from "@langchain/openai";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { z } from "zod";
import { randomUUID } from "crypto";
import { eq, asc } from "drizzle-orm";
import { db } from "../db/client.ts";
import { llmModels } from "../db/schema/index.ts";
import { agentRepository } from "../repositories/agent.repository.ts";
import { permissionRepository } from "../repositories/permission.repository.ts";
import { toolRepository } from "../repositories/tool.repository.ts";
import { skillRepository } from "../repositories/skill.repository.ts";
import { kbService } from "../services/kb.service.ts";
import { kbRepository } from "../repositories/kb.repository.ts";
import { buildAgentCallerTool } from "../lib/agent-tool.ts";
import { integrationRepository } from "../repositories/integration.repository.ts";
import { getComposioClient } from "../lib/composio.ts";
import { logger } from "../lib/logger.ts";
import { buildLazyBrowserAgentTool, type BrowserAgentEventEmitter } from "../lib/browser-agent-tool.ts";
import { buildExtensionBrowserAgentTool } from "../lib/extension-browser-agent-tool.ts";
import { buildVaultTools } from "../tools/vault.tools.ts";
import { buildSystemTools } from "../tools/system.tools.ts";
import { buildMemoryTools } from "../tools/memory.tools.ts";
import { buildPlanningTools, type Todo } from "../tools/planning.tools.ts";
import { buildWorkflowTools } from "../tools/workflow.tools.ts";
import { buildNotebookTools, loadNotebookEntries } from "../tools/notebook.tools.ts";
import { buildBucketTools } from "../tools/bucket.tools.ts";
import { buildBucketComposioBridgeTool } from "../tools/bucket-composio-bridge.tools.ts";
import { buildPythonTools } from "../tools/python.tools.ts";
import { buildWorkspaceUserTools } from "../tools/workspace-user.tools.ts";
import { buildCEOTools } from "../tools/ceo.tools.ts";
import { CEO_SYSTEM_PROMPT } from "../lib/ceo-prompt.ts";
import { buildTesterTools } from "../tools/tester.tools.ts";
import { TESTER_SYSTEM_PROMPT } from "../lib/tester-prompt.ts";
import { memoryRepository } from "../repositories/memory.repository.ts";
import { buildSystemPrompt } from "../lib/system-prompt-builder.ts";
import { browserRepository } from "../repositories/browser.repository.ts";
import {
    checkCredits,
    deductCredits,
    calculateCreditCost,
    isPlanSufficient,
} from "../lib/credit-engine.ts";
import { channelRepository } from "../repositories/channel.repository.ts";
import { channelManager } from "../channels/channel-manager.ts";
import { getBrowserAgentSettings } from "../lib/system-settings.ts";
import type {
    AgentCapabilities,
    KBCapability,
    SkillCapability,
    ToolCapability,
    MCPServerCapability,
    ConnectedAgent,
    ComposioIntegration,
    ChannelInfo,
    ChannelUserInfo,
    SystemPermissions,
} from "../lib/system-prompt-builder.ts";

const SUMMARIZE_THRESHOLD = 30; // Trigger summarization when messages exceed this count
const KEEP_MESSAGES = 10; // Keep the last N messages after summarization
const MAX_TOOL_ITERATIONS = 25; // Maximum agent→tool cycles before graceful termination

/**
 * Scans conversation history and builds a concise summary of tool call outcomes.
 * This helps the LLM avoid repeating failed tool calls and reuse successful patterns.
 * Returns an empty string if there are no tool calls in history.
 */
function buildToolUsageSummary(messages: BaseMessage[]): string {
    const toolResults: Array<{
        name: string;
        args: Record<string, unknown>;
        succeeded: boolean;
        resultPreview: string;
    }> = [];

    // Build a map of tool_call_id → tool call info from AIMessages
    const toolCallMap = new Map<string, { name: string; args: Record<string, unknown> }>();
    for (const msg of messages) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawToolCalls = (msg as any).tool_calls;
        if (Array.isArray(rawToolCalls)) {
            for (const tc of rawToolCalls as Array<{ id?: string; name: string; args: Record<string, unknown> }>) {
                if (tc.id) {
                    toolCallMap.set(tc.id, { name: tc.name, args: tc.args || {} });
                }
            }
        }
    }

    // Match ToolMessages to their originating tool calls
    for (const msg of messages) {
        if (msg instanceof ToolMessage && msg.tool_call_id) {
            const callInfo = toolCallMap.get(msg.tool_call_id);
            if (!callInfo) continue;

            const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
            const succeeded = !content.startsWith("Error:") && !content.startsWith("Error ") && !content.includes('"error"');
            toolResults.push({
                name: callInfo.name,
                args: callInfo.args,
                succeeded,
                resultPreview: content.slice(0, 150),
            });
        }
    }

    if (toolResults.length === 0) return "";

    // Group by tool name and build summary
    const failedTools: string[] = [];
    const succeededTools: string[] = [];
    // Track specific Composio tool slugs that worked vs failed
    const composioExecutions: Array<{ slug: string; succeeded: boolean; preview: string }> = [];

    for (const result of toolResults) {
        const entry = `${result.name}(${summarizeArgs(result.args)})`;
        if (result.succeeded) {
            succeededTools.push(entry);
        } else {
            failedTools.push(`${entry} → ${result.resultPreview}`);
        }

        // Track COMPOSIO_MULTI_EXECUTE_TOOL calls specifically
        if (result.name === "COMPOSIO_MULTI_EXECUTE_TOOL") {
            const slug = (result.args.tool_slug || result.args.action || "") as string;
            if (slug) {
                composioExecutions.push({
                    slug,
                    succeeded: result.succeeded,
                    preview: result.resultPreview,
                });
            }
        }
    }

    const parts: string[] = [];
    parts.push(`## Tool Usage History (This Conversation)`);
    parts.push(`You have made ${toolResults.length} tool call(s) so far. Review this before making new calls.\n`);

    if (failedTools.length > 0) {
        parts.push(`**FAILED tool calls (DO NOT repeat these with the same parameters):**`);
        // Deduplicate failed tools
        const uniqueFailed = [...new Set(failedTools)];
        for (const f of uniqueFailed.slice(0, 10)) {
            parts.push(`- ✗ ${f}`);
        }
        parts.push("");
    }

    if (succeededTools.length > 0) {
        parts.push(`**SUCCEEDED tool calls (reuse these patterns):**`);
        const uniqueSucceeded = [...new Set(succeededTools)];
        for (const s of uniqueSucceeded.slice(0, 10)) {
            parts.push(`- ✓ ${s}`);
        }
        parts.push("");
    }

    if (composioExecutions.length > 0) {
        const worked = composioExecutions.filter(e => e.succeeded).map(e => e.slug);
        const failed = composioExecutions.filter(e => !e.succeeded).map(e => e.slug);
        if (worked.length > 0) {
            parts.push(`**Working Composio tool slugs:** ${[...new Set(worked)].join(", ")}`);
        }
        if (failed.length > 0) {
            parts.push(`**Failed Composio tool slugs (avoid these):** ${[...new Set(failed)].join(", ")}`);
        }
        parts.push("");
    }

    parts.push(`**RULES based on history above:**`);
    parts.push(`- If a tool call failed, do NOT call it again with the same parameters.`);
    parts.push(`- If a tool call succeeded, reuse the EXACT same tool and pattern for similar tasks.`);
    parts.push(`- If you already discovered the right Composio tool slug, use it directly — do NOT call COMPOSIO_SEARCH_TOOLS again for the same action.`);
    parts.push(`- Minimize total tool calls. Be precise and intentional.`);

    return parts.join("\n");
}

/**
 * Quick scan of conversation messages for correction signals.
 * Returns true when the reflection node should run a deeper LLM analysis.
 *
 * Detects three categories:
 *  1. User corrections — phrases that indicate the user is correcting the agent
 *  2. Multiple tool failures — 2+ distinct tool errors in the conversation
 *  3. Tool self-correction — same tool retried with different args (fail→succeed),
 *     or different tool succeeded after a prior tool failed
 */
function detectCorrectionSignals(messages: BaseMessage[]): boolean {
    // ── 1. User correction phrases ─────────────────────────────────────
    // Each pattern is anchored with word boundaries (\b) where possible to
    // avoid false positives on substrings (e.g. "notice" matching "not ice").
    // Grouped by intent so it's easy to audit coverage.
    const correctionPatterns: RegExp[] = [
        // Direct negation / rejection
        /\bno[,.\s]+(?:do(?:n'?t)?|use|try|that|not|i\s)/i,
        /\bnot?\s+(?:like\s+that|what\s+i|that\s+way|correct|right|this\s+way)/i,
        /\bthat(?:'?s|\s+is)\s+(?:wrong|incorrect|not\s+(?:right|correct|what|how))/i,
        /\bthis\s+is\s+(?:wrong|incorrect|not\s+(?:right|correct|what|how))/i,

        // User clarifies intent ("I meant X", "I said X", NOT just "I need X")
        /\bi\s+(?:meant|said|asked\s+for|wanted)\b/i,
        /\bwhat\s+i\s+(?:meant|want(?:ed)?|need(?:ed)?|asked)\b/i,
        /\bi\s+didn'?t\s+(?:mean|say|ask|want)\b/i,

        // User redirects approach
        /\b(?:instead|rather)[,\s]+(?:do|use|try|of)\b/i,
        /\bdon'?t\s+(?:do|use|send|call|run|delete|create|make|add|remove)\b/i,
        /\bstop\s+(?:doing|using|sending|calling|running|trying)\b/i,
        /\bplease\s+(?:fix|correct|change|update|redo|undo|revert|retry)\b/i,
        /\bcan\s+you\s+(?:fix|correct|change|redo|undo|revert|retry)\b/i,

        // User signals the agent was wrong
        /\bwrong\s+(?:way|approach|method|tool|param(?:eter)?|format|file|url|path|endpoint)\b/i,
        /\byou(?:'?re|\s+are)\s+(?:wrong|mistaken|confused|doing\s+it\s+wrong)\b/i,
        /\bthat(?:'?s|\s+is)\s+(?:the\s+)?(?:old|outdated|deprecated|broken)\b/i,

        // User overrides with the right answer
        /\bactually[,\s]+(?:i\s+want|it(?:'?s|\s+is|\s+should)|do\s+it|use|the\s+(?:right|correct))\b/i,
        /\bthe\s+(?:correct|right|proper)\s+(?:way|approach|method|param|format|url|path|tool)\b/i,
        /\byou\s+should(?:'?ve|\s+have)?\s+(?:used|done|called|tried)\b/i,
        /\bnext\s+time[,\s]+(?:do|use|try|make\s+sure|remember)\b/i,

        // Explicit correction markers
        /\bcorrection\s*:/i,
        /\bfyi\s*:/i,
        /\bnote\s*:\s*(?:it|the|you|that|this|don)/i,
        /\bfor\s+(?:future|next\s+time)\b/i,
    ];

    // ── 2. Tool call tracking structures ───────────────────────────────
    // Map tool_call_id → { name, argsKey } from AIMessages
    const toolCallMap = new Map<string, { name: string; argsKey: string }>();
    // Track per-tool outcomes: tool name → { failedArgsKeys, succeededArgsKeys }
    const toolOutcomes = new Map<string, { failed: Set<string>; succeeded: Set<string> }>();
    let toolFailureCount = 0;

    for (const msg of messages) {
        // Check human messages for correction phrases
        if (msg instanceof HumanMessage) {
            const content = typeof msg.content === "string" ? msg.content : "";
            if (content.length > 0 && correctionPatterns.some((p) => p.test(content))) {
                return true;
            }
        }

        // Index tool calls from AI messages
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawToolCalls = (msg as any).tool_calls;
        if (Array.isArray(rawToolCalls)) {
            for (const tc of rawToolCalls as Array<{ id?: string; name: string; args?: Record<string, unknown> }>) {
                if (tc.id) {
                    // Create a stable key from sorted args to compare parameters
                    const argsKey = tc.args
                        ? JSON.stringify(Object.keys(tc.args).sort())
                        : "{}";
                    toolCallMap.set(tc.id, { name: tc.name, argsKey });
                }
            }
        }

        // Match tool results to their calls and track outcomes
        if (msg instanceof ToolMessage && msg.tool_call_id) {
            const callInfo = toolCallMap.get(msg.tool_call_id);
            if (!callInfo) continue;

            const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
            const isError =
                content.startsWith("Error:") ||
                content.startsWith("Error ") ||
                content.includes('"error"') ||
                content.includes('"Error"') ||
                content.includes("ECONNREFUSED") ||
                content.includes("ETIMEDOUT") ||
                content.includes("401") ||
                content.includes("403") ||
                content.includes("404") ||
                content.includes("500") ||
                /\bnot\s+found\b/i.test(content) ||
                /\bfailed\b/i.test(content) ||
                /\bunauthorized\b/i.test(content) ||
                /\bforbidden\b/i.test(content) ||
                /\binvalid\b/i.test(content.slice(0, 200)); // Only check start to avoid false positives in data

            if (isError) {
                toolFailureCount++;
            }

            // Track per-tool outcomes
            if (!toolOutcomes.has(callInfo.name)) {
                toolOutcomes.set(callInfo.name, { failed: new Set(), succeeded: new Set() });
            }
            const outcomes = toolOutcomes.get(callInfo.name)!;
            if (isError) {
                outcomes.failed.add(callInfo.argsKey);
            } else {
                outcomes.succeeded.add(callInfo.argsKey);
            }
        }
    }

    // ── 3. Multiple tool failures ──────────────────────────────────────
    if (toolFailureCount >= 2) {
        return true;
    }

    // ── 4. Tool self-correction detection ──────────────────────────────
    // Pattern A: Same tool called with different args — first failed, later succeeded.
    // This means the agent discovered the right parameters through trial.
    for (const [, outcomes] of toolOutcomes) {
        if (outcomes.failed.size > 0 && outcomes.succeeded.size > 0) {
            // Check that the failed and succeeded calls used different args
            // (identical args means a transient error, not a discovery)
            for (const failedArgs of outcomes.failed) {
                for (const succeededArgs of outcomes.succeeded) {
                    if (failedArgs !== succeededArgs) {
                        return true;
                    }
                }
            }
        }
    }

    // Pattern B: Different tools tried for the same intent — one failed, another succeeded.
    // Detected when we have both tool failures and tool successes across different tool names.
    const toolsWithFailures = new Set<string>();
    const toolsWithSuccesses = new Set<string>();
    for (const [name, outcomes] of toolOutcomes) {
        if (outcomes.failed.size > 0) toolsWithFailures.add(name);
        if (outcomes.succeeded.size > 0) toolsWithSuccesses.add(name);
    }
    // If different tools failed vs succeeded, the agent discovered the right tool
    if (toolsWithFailures.size > 0 && toolsWithSuccesses.size > 0) {
        for (const successTool of toolsWithSuccesses) {
            if (!toolsWithFailures.has(successTool)) {
                // A tool that only succeeded exists alongside a tool that only failed
                return true;
            }
        }
    }

    return false;
}

/**
 * Load tool-scoped procedural memory from LangGraph PostgresStore.
 * Uses a single prefix-namespace search (one embedding API call) instead of
 * per-tool queries (N embedding calls) to avoid O(N) latency on agents with many tools.
 * Learnings are workspace-wide — any agent using the same tool benefits.
 */
async function loadProceduralMemory(
    store: PostgresStore,
    workspaceId: string,
    toolNames: string[],
    userMessage?: string,
): Promise<string> {
    try {
        if (toolNames.length === 0) return "";

        // Single prefix-namespace search across all tool learnings (1 embedding call)
        const namespace = [workspaceId, "tool_learnings"];
        const searchOpts: { limit: number; query?: string } = { limit: 20 };
        if (userMessage) {
            searchOpts.query = userMessage;
        }

        const items = await store.search(namespace, searchOpts);
        if (items.length === 0) return "";

        // Filter to learnings for tools this agent actually has, group by tool
        const toolNameSet = new Set(toolNames);
        const byTool = new Map<string, string[]>();
        for (const item of items) {
            const toolName = item.namespace[2]; // [workspaceId, "tool_learnings", toolName]
            if (!toolName || !toolNameSet.has(toolName)) continue;
            const learning = item.value.learning as string;
            if (!learning) continue;
            if (!byTool.has(toolName)) byTool.set(toolName, []);
            byTool.get(toolName)!.push(learning);
        }

        if (byTool.size === 0) return "";

        const sections = [...byTool.entries()]
            .map(([tool, learnings]) =>
                `**${tool}:**\n${learnings.map((l) => `- ${l}`).join("\n")}`
            )
            .join("\n\n");

        return (
            `## Learned Instructions (from past experience)\n` +
            `These are lessons learned from previous conversations. They apply to ALL agents using these tools. FOLLOW THEM:\n\n${sections}`
        );
    } catch (error) {
        logger.warn({ error }, "Failed to load procedural memory");
        return "";
    }
}

/** Summarize tool args into a short string for the usage summary */
function summarizeArgs(args: Record<string, unknown>): string {
    const entries = Object.entries(args);
    if (entries.length === 0) return "";
    const parts = entries.slice(0, 3).map(([k, v]) => {
        const val = typeof v === "string" ? v.slice(0, 50) : JSON.stringify(v)?.slice(0, 50);
        return `${k}=${val}`;
    });
    if (entries.length > 3) parts.push("...");
    return parts.join(", ");
}

/**
 * Sanitize message history to ensure proper tool call/response pairing.
 * Required for providers like Gemini that mandate tool responses immediately follow tool calls.
 * Removes orphaned ToolMessages and strips orphaned tool_calls from AIMessages.
 *
 * SAFETY: Uses raw property access (not instanceof/class checks) to handle
 * AIMessage, AIMessageChunk, and any future variants. Includes a failsafe:
 * if we detect ToolMessages but fail to find ANY tool_calls (detection bug),
 * we skip sanitization entirely rather than deleting valid messages.
 */
function sanitizeMessagesForProvider(messages: BaseMessage[]): BaseMessage[] {
    const toolCallIds = new Set<string>();
    const toolResponseIds = new Set<string>();

    for (const msg of messages) {
        // Use raw property access — works for AIMessage, AIMessageChunk, and
        // any object that carries a tool_calls array, regardless of class hierarchy.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawToolCalls = (msg as any).tool_calls;
        if (Array.isArray(rawToolCalls) && rawToolCalls.length > 0) {
            for (const tc of rawToolCalls as Array<{ id?: string }>) {
                if (tc.id) toolCallIds.add(tc.id);
            }
        }
        if (msg instanceof ToolMessage && msg.tool_call_id) {
            toolResponseIds.add(msg.tool_call_id);
        }
    }

    const orphanedResponses = new Set<string>();
    for (const id of toolResponseIds) {
        if (!toolCallIds.has(id)) orphanedResponses.add(id);
    }
    const orphanedCalls = new Set<string>();
    for (const id of toolCallIds) {
        if (!toolResponseIds.has(id)) orphanedCalls.add(id);
    }

    if (orphanedResponses.size === 0 && orphanedCalls.size === 0) {
        return messages;
    }

    // FAILSAFE: If we found ToolMessages but zero tool_calls, our detection
    // is broken. Return messages unchanged rather than deleting valid responses.
    if (toolCallIds.size === 0 && toolResponseIds.size > 0) {
        logger.error({
            toolResponseCount: toolResponseIds.size,
        }, "Sanitization failsafe: found ToolMessages but zero tool_calls — skipping sanitization to avoid data loss");
        return messages;
    }

    logger.warn({
        orphanedResponses: orphanedResponses.size,
        orphanedCalls: orphanedCalls.size,
        totalToolCalls: toolCallIds.size,
        totalToolResponses: toolResponseIds.size,
    }, "Sanitizing orphaned tool call/response messages");

    const result: BaseMessage[] = [];
    for (const msg of messages) {
        if (msg instanceof ToolMessage && msg.tool_call_id && orphanedResponses.has(msg.tool_call_id)) {
            logger.info({ removedToolCallId: msg.tool_call_id, toolName: msg.name }, "Removing orphaned ToolMessage");
            continue;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawToolCalls2 = (msg as any).tool_calls;
        if (Array.isArray(rawToolCalls2) && rawToolCalls2.length > 0) {
            const validCalls = rawToolCalls2.filter((tc: { id?: string }) => !tc.id || !orphanedCalls.has(tc.id));
            if (validCalls.length === 0) {
                const text = typeof msg.content === "string"
                    ? msg.content
                    : Array.isArray(msg.content)
                        ? (msg.content as Array<{ type: string; text?: string }>)
                            .filter(b => b.type === "text")
                            .map(b => b.text ?? "")
                            .join("")
                        : "";
                if (text) {
                    result.push(new AIMessage({ content: text, id: msg.id }));
                }
                continue;
            }
            if (validCalls.length < rawToolCalls2.length) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                result.push(new AIMessage({ content: msg.content as any, tool_calls: validCalls, id: msg.id }));
                continue;
            }
        }

        result.push(msg);
    }

    return result;
}

/**
 * Recover tool calls that the model output as JSON text instead of using the
 * API's native tool calling mechanism. This is a known intermittent issue with
 * Claude where it sometimes serializes tool calls as text content rather than
 * producing proper tool_use content blocks.
 *
 * Detects: {"tool_calls":[{"name":"TOOL_NAME","input":{...}}]}
 * Returns parsed tool calls and cleaned text, or null if nothing found.
 */
function recoverToolCallsFromText(
    content: string | Array<{ type: string; text?: string }>,
    availableToolNames: Set<string>
): { toolCalls: Array<{ name: string; args: Record<string, unknown>; id: string; type: "tool_call" }>; cleanedContent: string } | null {
    const text = typeof content === "string"
        ? content
        : Array.isArray(content)
            ? (content as Array<{ type: string; text?: string }>)
                .filter(b => b.type === "text")
                .map(b => b.text ?? "")
                .join("")
            : "";

    if (!text || !text.includes('"tool_calls"')) return null;

    // Find the {"tool_calls": marker
    const marker = '"tool_calls"';
    const markerIdx = text.indexOf(marker);
    if (markerIdx === -1) return null;

    // Walk backwards to find the opening {
    let start = markerIdx - 1;
    while (start >= 0 && /\s/.test(text[start])) start--;
    if (start < 0 || text[start] !== '{') return null;

    // Use brace counting to find the matching closing }
    let depth = 0;
    let end = -1;
    for (let i = start; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') {
            depth--;
            if (depth === 0) {
                end = i + 1;
                break;
            }
        }
    }
    if (end === -1) return null;

    const jsonStr = text.substring(start, end);
    try {
        const parsed = JSON.parse(jsonStr);
        if (!Array.isArray(parsed.tool_calls) || parsed.tool_calls.length === 0) {
            return null;
        }

        const toolCalls = parsed.tool_calls
            .filter((tc: Record<string, unknown>) =>
                typeof tc.name === "string" && availableToolNames.has(tc.name as string)
            )
            .map((tc: Record<string, unknown>) => ({
                name: tc.name as string,
                args: ((tc.input ?? tc.args ?? {}) as Record<string, unknown>),
                id: (typeof tc.id === "string" ? tc.id : null) || `recovered-${randomUUID()}`,
                type: "tool_call" as const,
            }));

        if (toolCalls.length === 0) return null;

        const cleanedContent = (text.substring(0, start) + text.substring(end)).trim();
        return { toolCalls, cleanedContent };
    } catch {
        return null;
    }
}

export interface TraceStep {
    tool: string;
    args: Record<string, unknown>;
    output: string;
    durationMs: number;
    succeeded: boolean;
    timestamp: string;
}

const AgentState = Annotation.Root({
    ...MessagesAnnotation.spec,
    summary: Annotation<string>({
        reducer: (_curr: string, update: string) => update,
        default: () => "",
    }),
    todos: Annotation<Todo[]>({
        reducer: (_curr: Todo[], update: Todo[]) => update,
        default: () => [],
    }),
    step_count: Annotation<number>({
        reducer: (_curr: number, update: number) => update,
        default: () => 0,
    }),
    execution_trace: Annotation<TraceStep[]>({
        reducer: (curr: TraceStep[], update: TraceStep[]) => [...curr, ...update],
        default: () => [],
    }),
});

let checkpointerInstance: PostgresSaver | null = null;

async function getCheckpointer(): Promise<PostgresSaver> {
    if (!checkpointerInstance) {
        checkpointerInstance = PostgresSaver.fromConnString(
            process.env.DATABASE_URL!
        );
        await checkpointerInstance.setup();
    }
    return checkpointerInstance;
}

let storeInstance: PostgresStore | null = null;

export async function getStore(): Promise<PostgresStore> {
    if (!storeInstance) {
        // Configure vector search for procedural memory when OpenRouter is available
        if (process.env.OPENROUTER_KEY) {
            storeInstance = PostgresStore.fromConnString(
                process.env.DATABASE_URL!,
                {
                    index: {
                        dims: 1536,
                        embed: new OpenAIEmbeddings({
                            model: "text-embedding-3-small",
                            configuration: {
                                baseURL: "https://openrouter.ai/api/v1",
                                apiKey: process.env.OPENROUTER_KEY,
                                defaultHeaders: {
                                    "HTTP-Referer": "https://pushable.ai",
                                    "X-Title": "Pushable AI",
                                },
                            },
                        }),
                        fields: ["learning"], // Only embeds items with a "learning" field (procedural memory)
                    },
                },
            );
        } else {
            storeInstance = PostgresStore.fromConnString(process.env.DATABASE_URL!);
        }
        await storeInstance.setup();
    }
    return storeInstance;
}

// For now, workspace plan is always "scale". Replace when subscription system is built.
function getWorkspacePlan(_workspaceId: string): string {
    return "scale";
}

/**
 * Look up the model from our curated llmModels table.
 * If not found or plan-gated, find a fallback.
 */
async function resolveModel(
    requestedModelId: string,
    workspaceId: string
): Promise<{ modelId: string; multiplier: number; displayName: string }> {
    const plan = getWorkspacePlan(workspaceId);

    // Try to find the requested model
    const rows = await db
        .select()
        .from(llmModels)
        .where(eq(llmModels.modelId, requestedModelId))
        .limit(1);

    if (rows.length > 0) {
        const m = rows[0];
        if (m.isActive && isPlanSufficient(plan, m.minimumPlan)) {
            return {
                modelId: m.modelId,
                multiplier: Number(m.multiplier),
                displayName: m.displayName,
            };
        }

        // Model exists but plan-gated — find fallback
        logger.warn(
            { requestedModelId, plan, requiredPlan: m.minimumPlan },
            "Model requires higher plan, falling back"
        );
    }

    // Find best available model on this plan (highest sortOrder that is available)
    const available = await db
        .select()
        .from(llmModels)
        .where(eq(llmModels.isActive, true))
        .orderBy(asc(llmModels.sortOrder));

    const fallback = available.find((m) => isPlanSufficient(plan, m.minimumPlan));

    if (fallback) {
        logger.info(
            { requestedModelId, fallbackModelId: fallback.modelId },
            "Falling back to plan-available model"
        );
        return {
            modelId: fallback.modelId,
            multiplier: Number(fallback.multiplier),
            displayName: fallback.displayName,
        };
    }

    // No models in DB at all — use requested model with default multiplier
    return { modelId: requestedModelId, multiplier: 1.0, displayName: requestedModelId };
}

// ── Graph cache ──────────────────────────────────────────────────────────────
// Caches compiled agent graphs per session to avoid expensive DB queries,
// MCP connections, and Composio API calls on every message.
// A mutable ref is used for onBrowserEvent so the cached graph always
// emits browser events to the current run's event bus.

interface GraphCacheEntry {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    graph: any; // CompiledStateGraph returned by graph.compile()
    runReflection: (messages: BaseMessage[]) => Promise<void>;
    browserEventRef: { current: BrowserAgentEventEmitter | undefined };
    toolsByName: Map<string, DynamicStructuredTool>;
    timestamp: number;
}

// ── Debug info cache ─────────────────────────────────────────────────────────
// Stores debug metadata (system prompt, tools, model, capabilities) per agent
// so the chat route can emit it to the frontend for the debug panel.

export interface AgentDebugInfo {
    agentName: string;
    agentId: string;
    modelId: string;
    modelDisplayName: string;
    temperature: number;
    systemPrompt: string;
    tools: Array<{ name: string; description: string; type: string }>;
    capabilities: {
        kbCount: number;
        skillCount: number;
        toolCount: number;
        mcpServerCount: number;
        hasBrowser: boolean;
        hasExtensionBrowser: boolean;
        connectedAgentCount: number;
        composioIntegrationCount: number;
        channelCount: number;
        systemLevelAccess: boolean;
    };
    kbs: Array<{ name: string; description: string | null; documentCount: number }>;
    skills: Array<{ name: string; description: string | null }>;
    mcpServers: Array<{ name: string; toolNames: string[] }>;
    connectedAgents: Array<{ name: string; role: string }>;
    composioIntegrations: Array<{ app: string; connectionLabel: string }>;
    channels: Array<{ name: string; channelType: string }>;
    timestamp: number;
}

const debugInfoCache = new Map<string, AgentDebugInfo>();

/** Get cached debug info for an agent (populated during graph creation) */
export function getAgentDebugInfo(agentId: string, workspaceId: string): AgentDebugInfo | null {
    const prefix = `${agentId}:${workspaceId}:`;
    for (const [key, info] of debugInfoCache) {
        if (key.startsWith(prefix)) return info;
    }
    return null;
}

const graphCache = new Map<string, GraphCacheEntry>();
const GRAPH_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Evict stale entries periodically to prevent memory leaks */
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of graphCache) {
        if (now - entry.timestamp > GRAPH_CACHE_TTL_MS * 2) {
            graphCache.delete(key);
            debugInfoCache.delete(key);
        }
    }
}, GRAPH_CACHE_TTL_MS).unref();

/** Invalidate cache for a specific agent (call after agent config changes) */
export function invalidateGraphCache(agentId: string, workspaceId: string): void {
    const prefix = `${agentId}:${workspaceId}:`;
    for (const key of graphCache.keys()) {
        if (key.startsWith(prefix)) {
            graphCache.delete(key);
        }
    }
}

export async function createAgentGraph(
    agentId: string,
    workspaceId: string,
    userId?: string,
    onBrowserEvent?: BrowserAgentEventEmitter,
    chatSessionId?: string
) {
    // Read browser agent model early so it can be part of cache key
    const browserAgentSettings = await getBrowserAgentSettings();
    const browserModelId = browserAgentSettings.model;

    // Check graph cache — reuse compiled graph for same session + same browser model
    const cacheKey = `${agentId}:${workspaceId}:${userId || ""}:${chatSessionId || ""}:${browserModelId}`;
    const cached = graphCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < GRAPH_CACHE_TTL_MS) {
        // Update browser event ref to point to current run's handler
        cached.browserEventRef.current = onBrowserEvent;
        logger.info({ agentId, cacheKey }, "Using cached agent graph");
        return { graph: cached.graph, runReflection: cached.runReflection };
    }

    const agent = await agentRepository.findById(agentId, workspaceId);
    if (!agent) throw new Error("Agent not found");

    // --- Resolve model with plan gating ---
    const resolvedModel = await resolveModel(agent.model, workspaceId);
    const modelId = resolvedModel.modelId;
    const modelMultiplier = resolvedModel.multiplier;

    const agentTemperature = agent.temperature ?? 0.7;
    const { llm, isClaudeDirect, supportsPromptCaching, recreate: recreateLLM } = createLLM({
        modelId,
        temperature: agentTemperature,
    });

    // --- Fetch all capability data in parallel ---
    // CEO and Tester agents get access to ALL workspace resources (no permission filtering)
    const [
        allowedToolIds,
        allowedAgentIds,
        allowedKbIds,
        allowedSkillIds,
        browserProfile,
        agentIntegrations,
    ] = (agent.isCeo || agent.isTester)
        ? await Promise.all([
            toolRepository.findByWorkspace(workspaceId).then((t) => t.map((r) => r.id)),
            agentRepository.findByWorkspace(workspaceId).then((a) => a.filter((r) => r.id !== agentId).map((r) => r.id)),
            kbRepository.findKBsByWorkspace(workspaceId).then((k) => k.map((r) => r.id)),
            skillRepository.findByWorkspace(workspaceId).then((s) => s.map((r) => r.id)),
            browserRepository.findProfileByAgentId(agentId, workspaceId),
            integrationRepository.findByWorkspace(workspaceId).then((i) => i.filter((r) => r.status === "active")),
        ])
        : await Promise.all([
            permissionRepository.getAllowedResourceIds(agentId, workspaceId, "tool"),
            permissionRepository.getAllowedResourceIds(agentId, workspaceId, "agent"),
            permissionRepository.getAllowedResourceIds(agentId, workspaceId, "kb"),
            permissionRepository.getAllowedResourceIds(agentId, workspaceId, "skill"),
            browserRepository.findProfileByAgentId(agentId, workspaceId),
            integrationRepository.findByAgent(agentId, workspaceId),
        ]);

    const langchainTools: DynamicStructuredTool[] = [];
    const mcpClients: MultiServerMCPClient[] = [];

    const toolCapabilities: ToolCapability[] = [];
    const mcpServerCapabilities: MCPServerCapability[] = [];
    const composioIntegrations: ComposioIntegration[] = [];

    // --- Browser event ref (must exist before parallel block so browser task can close over it) ---
    const browserEventRef: { current: BrowserAgentEventEmitter | undefined } = { current: onBrowserEvent };
    const stableBrowserEventEmitter: BrowserAgentEventEmitter = (event) => {
        browserEventRef.current?.(event);
    };
    const browserType = agent.browserType || "cloud";
    logger.info({ browserModelId }, "Browser agent using model from system_settings");

    // --- Parallel I/O: load all tool categories concurrently ---
    // All categories are independent — run them simultaneously to cut total loading
    // time from sum-of-latencies down to max-of-latencies.
    const [
        functionMcpResult,
        delegationResult,
        composioResult,
        browserToolResult,
        kbResult,
        vaultResult,
        skillResult,
        channelResult,
        storeResult,
    ] = await Promise.allSettled([

        // 1. Function & MCP tools
        (async () => {
            const tools: DynamicStructuredTool[] = [];
            const capabilities: ToolCapability[] = [];
            const clients: MultiServerMCPClient[] = [];
            const mcpCapabilities: MCPServerCapability[] = [];
            if (allowedToolIds.length === 0) return { tools, capabilities, clients, mcpCapabilities };

            const dbTools = await toolRepository.findByIds(allowedToolIds);

            // Function tools — sync construction, no network I/O
            for (const tool of dbTools) {
                if (tool.type !== "function") continue;
                const config = tool.config as Record<string, unknown>;
                const webhookUrl = config.webhookUrl as string;
                if (!webhookUrl) {
                    logger.warn({ toolId: tool.id }, "Function tool missing webhookUrl, skipping");
                    continue;
                }
                const method = ((config.method as string) || "POST").toUpperCase();
                const varPattern = /\{\{(\w+)\}\}/g;
                const urlVars: string[] = [];
                let match;
                while ((match = varPattern.exec(webhookUrl)) !== null) {
                    if (!urlVars.includes(match[1])) urlVars.push(match[1]);
                }
                const schemaFields: Record<string, z.ZodTypeAny> = {};
                for (const v of urlVars) {
                    schemaFields[v] = z.string().describe(`Value for {{${v}}} in the URL`);
                }
                if (method === "POST") {
                    schemaFields["input"] = z.string().describe("The input/body to send to the tool").optional();
                }
                if (urlVars.length === 0 && method !== "POST") {
                    schemaFields["input"] = z.string().describe("The input to send to the tool").optional();
                }
                const paramDesc = Object.keys(schemaFields).join(", ") || "none";
                const functionTool = new DynamicStructuredTool({
                    name: tool.name.replace(/[^a-zA-Z0-9_-]/g, "_"),
                    description: tool.description || `Execute ${tool.name}`,
                    schema: z.object(schemaFields),
                    func: async (params) => {
                        let resolvedUrl = webhookUrl;
                        for (const v of urlVars) {
                            resolvedUrl = resolvedUrl.replace(
                                new RegExp(`\\{\\{${v}\\}\\}`, "g"),
                                encodeURIComponent(params[v] as string)
                            );
                        }
                        const controller = new AbortController();
                        const timeout = setTimeout(() => controller.abort(), 30_000);
                        try {
                            const fetchOptions: RequestInit = { method, signal: controller.signal };
                            if (method === "POST") {
                                fetchOptions.headers = { "Content-Type": "application/json" };
                                fetchOptions.body = JSON.stringify({ input: params.input ?? "" });
                            }
                            const response = await fetch(resolvedUrl, fetchOptions);
                            return await response.text();
                        } catch (error) {
                            logger.error({ error, toolId: tool.id }, "Function tool call failed");
                            return `Error calling tool: ${error instanceof Error ? error.message : "Unknown error"}`;
                        } finally {
                            clearTimeout(timeout);
                        }
                    },
                });
                tools.push(functionTool);
                capabilities.push({ name: tool.name, description: tool.description, parameters: paramDesc });
            }

            // MCP tools — connect to all servers in parallel (each needs network I/O)
            const mcpDbTools = dbTools.filter((t) => t.type === "mcp");
            if (mcpDbTools.length > 0) {
                const mcpResults = await Promise.allSettled(
                    mcpDbTools.map(async (tool) => {
                        const config = tool.config as Record<string, unknown>;
                        const mcpUrl = config.url as string;
                        if (!mcpUrl) {
                            logger.warn({ toolId: tool.id }, "MCP tool missing URL, skipping");
                            return null;
                        }
                        const mcpClient = new MultiServerMCPClient({
                            [tool.name]: { url: mcpUrl, transport: "sse" },
                        });
                        const mcpToolsList = await mcpClient.getTools();
                        const toolNames = config.toolNames as string[] | undefined;
                        const filtered = toolNames && toolNames.length > 0
                            ? mcpToolsList.filter((t) => toolNames.includes(t.name))
                            : mcpToolsList;
                        return {
                            client: mcpClient,
                            tools: filtered,
                            capability: {
                                name: tool.name,
                                description: tool.description,
                                toolNames: filtered.map((t) => t.name),
                            },
                        };
                    })
                );
                for (const r of mcpResults) {
                    if (r.status === "fulfilled" && r.value) {
                        clients.push(r.value.client);
                        for (const t of r.value.tools) tools.push(t as DynamicStructuredTool);
                        mcpCapabilities.push(r.value.capability);
                    } else if (r.status === "rejected") {
                        logger.warn({ error: r.reason }, "Failed to connect to MCP server, skipping");
                    }
                }
            }
            return { tools, capabilities, clients, mcpCapabilities };
        })(),

        // 2. Agent delegation tools
        (async () => {
            const tools: DynamicStructuredTool[] = [];
            const agents: ConnectedAgent[] = [];
            const delegateIds = allowedAgentIds.filter((id) => id !== agentId);
            if (delegateIds.length === 0) return { tools, agents };
            const results = await Promise.all(
                delegateIds.map(async (targetAgentId) => {
                    try {
                        const targetAgent = await agentRepository.findById(targetAgentId, workspaceId);
                        if (targetAgent) {
                            const agentTool = await buildAgentCallerTool(agentId, targetAgentId, workspaceId);
                            if (agentTool) {
                                return {
                                    tool: agentTool,
                                    agent: {
                                        id: targetAgent.id,
                                        name: targetAgent.name,
                                        role: targetAgent.systemPrompt?.split("\n")[0] || "General Assistant",
                                    } as ConnectedAgent,
                                };
                            }
                        }
                        return null;
                    } catch (error) {
                        logger.warn({ error, targetAgentId }, "Failed to build agent caller tool, skipping");
                        return null;
                    }
                })
            );
            for (const r of results) {
                if (r) { tools.push(r.tool); agents.push(r.agent); }
            }
            return { tools, agents };
        })(),

        // 3. Composio integration tools (external API calls)
        (async () => {
            const tools: DynamicStructuredTool[] = [];
            const integrations: ComposioIntegration[] = [];
            let count = 0;
            const activeIntegrations = agentIntegrations.filter((i) => i.status === "active");
            if (activeIntegrations.length === 0) return { tools, integrations, count };
            try {
                const composio = getComposioClient();
                const toolkitSlugs = [...new Set(activeIntegrations.map((i) => i.composioToolkitSlug))];
                const toolsConfig: Record<string, { enable: string[] } | { disable: string[] }> = {};
                for (const integ of activeIntegrations) {
                    const slug = integ.composioToolkitSlug;
                    const perms = (integ.metadata as Record<string, unknown>)?.toolPermissions as {
                        mode?: string; tools?: string[];
                    } | undefined;
                    if (perms?.tools && perms.tools.length > 0) {
                        toolsConfig[slug] = perms.mode === "allowlist"
                            ? { enable: perms.tools }
                            : { disable: perms.tools };
                    }
                }
                const sessionConfig: Record<string, unknown> = { toolkits: toolkitSlugs };
                if (Object.keys(toolsConfig).length > 0) sessionConfig.tools = toolsConfig;
                const session = await composio.create(workspaceId, sessionConfig);
                const composioTools = await session.tools();
                if (Array.isArray(composioTools)) {
                    for (const tool of composioTools) {
                        tools.push(tool as unknown as DynamicStructuredTool);
                        count++;
                    }
                }
                for (const integ of activeIntegrations) {
                    const slug = integ.composioToolkitSlug;
                    integrations.push({
                        connectionLabel: integ.connectionLabel || integ.name,
                        connectionDescription: integ.connectionDescription ?? undefined,
                        app: slug,
                        appDisplayName: slug.charAt(0).toUpperCase() + slug.slice(1),
                        actions: [`Use COMPOSIO_SEARCH_TOOLS to find ${slug} actions, then COMPOSIO_MULTI_EXECUTE_TOOL to execute them`],
                    });
                }
            } catch (error) {
                logger.warn({ error, agentId }, "Failed to load Composio tools, proceeding without them");
            }
            return { tools, integrations, count };
        })(),

        // 4. Browser agent tool — lazy init: registers tool instantly, defers Chromium startup to first invocation
        (async () => {
            let tool: DynamicStructuredTool | null = null;
            let hasBrowser = false;
            if (browserType === "cloud") {
                try {
                    tool = buildLazyBrowserAgentTool(
                        agentId, workspaceId, browserModelId, modelMultiplier,
                        agentTemperature, stableBrowserEventEmitter, chatSessionId
                    );
                    hasBrowser = true;
                } catch (error) {
                    logger.warn({ error, agentId }, "Failed to create lazy browser agent tool, proceeding without it");
                }
            } else if (browserType === "extension") {
                try {
                    tool = buildExtensionBrowserAgentTool(
                        agentId, workspaceId, modelMultiplier,
                        agentTemperature, stableBrowserEventEmitter, browserModelId
                    );
                    hasBrowser = !!tool;
                } catch (error) {
                    logger.warn({ error, agentId }, "Failed to load extension browser agent, proceeding without it");
                }
            }
            return { tool, hasBrowser };
        })(),

        // 5. KB metadata for system prompt builder
        (async () => {
            const kbCapabilities: KBCapability[] = [];
            if (allowedKbIds.length === 0) return kbCapabilities;
            try {
                const kbs = await kbRepository.findKBsByIds(allowedKbIds, workspaceId);
                const kbsWithDocs = await Promise.all(
                    kbs.map(async (kb) => {
                        const docs = await kbRepository.findDocumentsByKB(kb.id, workspaceId);
                        return { name: kb.name, description: kb.description, documentCount: docs.length };
                    })
                );
                kbCapabilities.push(...kbsWithDocs);
            } catch (error) {
                logger.warn({ error }, "Failed to fetch KB metadata for prompt builder");
            }
            return kbCapabilities;
        })(),

        // 6. Vault tools (Bitwarden credential access)
        (async () => {
            try {
                return await buildVaultTools(workspaceId);
            } catch (error) {
                logger.warn({ error, agentId }, "Failed to load vault tools, proceeding without them");
                return [] as DynamicStructuredTool[];
            }
        })(),

        // 7. Skill metadata for system prompt builder
        (async () => {
            try {
                return await skillRepository.findByIds(allowedSkillIds, workspaceId);
            } catch (error) {
                logger.warn({ error }, "Failed to fetch skill metadata");
                return [] as Awaited<ReturnType<typeof skillRepository.findByIds>>;
            }
        })(),

        // 9. Channel awareness + send message tool
        (async () => {
            const channelInfos: ChannelInfo[] = [];
            let sendChannelTool: DynamicStructuredTool | null = null;
            try {
                const allConnections = await channelRepository.findByWorkspace(workspaceId);
                const agentConnections = allConnections.filter(
                    (c) => c.agentId === agentId && c.status === "active"
                );
                for (const conn of agentConnections) {
                    const config = (conn.config || {}) as Record<string, unknown>;
                    const knownUsersMap = (config.knownUsers as Record<
                        string,
                        { username: string; firstName: string; chatId?: string }
                    >) || {};
                    const users: ChannelUserInfo[] = Object.entries(knownUsersMap).map(
                        ([uid, info]) => ({
                            userId: uid,
                            username: info.username || "",
                            firstName: info.firstName || "",
                            chatId: info.chatId,
                        })
                    );
                    channelInfos.push({
                        connectionId: conn.id,
                        channelType: conn.channelType as "telegram" | "slack",
                        name: conn.name,
                        status: conn.status,
                        knownUsers: users,
                    });
                }
                if (agentConnections.length > 0) {
                    sendChannelTool = new DynamicStructuredTool({
                        name: "send_channel_message",
                        description:
                            "Send a message to a specific user on a connected messaging channel (Telegram/Slack). " +
                            "You can identify the user by their name, username, or user ID. " +
                            "The system will resolve the correct user from known users.",
                        schema: z.object({
                            user: z.string().describe("The user to send to — can be a name (e.g. 'John'), username (e.g. 'john_doe'), or user ID"),
                            message: z.string().describe("The message text to send"),
                            channel_name: z.string().optional().describe("Optional: specific channel connection name if the agent has multiple channels"),
                        }),
                        func: async (params) => {
                            const { user, message, channel_name } = params;
                            let targetConnections = agentConnections;
                            if (channel_name) {
                                targetConnections = agentConnections.filter(
                                    (c) => c.name.toLowerCase().includes(channel_name.toLowerCase())
                                );
                                if (targetConnections.length === 0) {
                                    return `No channel found matching "${channel_name}". Available: ${agentConnections.map((c) => c.name).join(", ")}`;
                                }
                            }
                            const userLower = user.toLowerCase().replace(/^@/, "");
                            for (const conn of targetConnections) {
                                const connConfig = (conn.config || {}) as Record<string, unknown>;
                                const knownUsersMap = (connConfig.knownUsers as Record<
                                    string,
                                    { username: string; firstName: string; chatId?: string }
                                >) || {};
                                const matchedEntry = Object.entries(knownUsersMap).find(([uid, info]) =>
                                    uid === user ||
                                    (info.username && info.username.toLowerCase() === userLower) ||
                                    (info.firstName && info.firstName.toLowerCase() === userLower)
                                );
                                if (matchedEntry) {
                                    const [uid, userInfo] = matchedEntry;
                                    const chatId = userInfo.chatId || uid;
                                    if (conn.channelType === "telegram") {
                                        const telegramAdapter = channelManager.getTelegramAdapter();
                                        const sent = await telegramAdapter.sendDirectMessage(conn.id, chatId, message);
                                        if (sent) {
                                            return `Message sent to ${userInfo.firstName || userInfo.username || uid} on ${conn.name} (Telegram).`;
                                        }
                                        return `Failed to send message to user. They may need to start a conversation with the bot first.`;
                                    }
                                    return `Sending messages on ${conn.channelType} is not yet supported.`;
                                }
                            }
                            const allUsers: string[] = [];
                            for (const conn of targetConnections) {
                                const connConfig = (conn.config || {}) as Record<string, unknown>;
                                const knownUsersMap = (connConfig.knownUsers as Record<string, { username: string; firstName: string }>) || {};
                                for (const [uid, info] of Object.entries(knownUsersMap)) {
                                    allUsers.push(info.firstName || info.username || uid);
                                }
                            }
                            if (allUsers.length > 0) return `No user found matching "${user}". Known users: ${allUsers.join(", ")}`;
                            return `No user found matching "${user}". No users have interacted with the bot yet.`;
                        },
                    });
                }
            } catch (error) {
                logger.warn({ error, agentId }, "Failed to load channel info for agent");
            }
            return { channelInfos, sendChannelTool };
        })(),

        // Store — fetched in parallel so it's ready for notebook tools below
        getStore(),
    ]);

    // --- Merge parallel results into shared collections ---
    if (functionMcpResult.status === "fulfilled") {
        langchainTools.push(...functionMcpResult.value.tools);
        toolCapabilities.push(...functionMcpResult.value.capabilities);
        mcpClients.push(...functionMcpResult.value.clients);
        mcpServerCapabilities.push(...functionMcpResult.value.mcpCapabilities);
    } else {
        logger.warn({ error: functionMcpResult.reason }, "Function/MCP tool loading failed");
    }

    const connectedAgents: ConnectedAgent[] = [];
    if (delegationResult.status === "fulfilled") {
        langchainTools.push(...delegationResult.value.tools);
        connectedAgents.push(...delegationResult.value.agents);
    } else {
        logger.warn({ error: delegationResult.reason }, "Agent delegation tool loading failed");
    }

    let composioToolCount = 0;
    if (composioResult.status === "fulfilled") {
        langchainTools.push(...composioResult.value.tools);
        composioIntegrations.push(...composioResult.value.integrations);
        composioToolCount = composioResult.value.count;
    } else {
        logger.warn({ error: composioResult.reason }, "Composio tool loading failed");
    }

    let hasBrowser = false;
    if (browserToolResult.status === "fulfilled") {
        if (browserToolResult.value.tool) langchainTools.push(browserToolResult.value.tool);
        hasBrowser = browserToolResult.value.hasBrowser;
    } else {
        logger.warn({ error: browserToolResult.reason }, "Browser tool loading failed");
    }

    const kbCapabilities: KBCapability[] = kbResult.status === "fulfilled" ? kbResult.value : [];

    if (vaultResult.status === "fulfilled") {
        langchainTools.push(...vaultResult.value);
    } else {
        logger.warn({ error: vaultResult.reason }, "Vault tool loading failed");
    }

    const permittedSkills = skillResult.status === "fulfilled" ? skillResult.value : [];
    const skillCapabilities: SkillCapability[] = permittedSkills.map((s) => ({
        name: s.name,
        description: s.description,
    }));

    const channelInfos: ChannelInfo[] = [];
    if (channelResult.status === "fulfilled") {
        channelInfos.push(...channelResult.value.channelInfos);
        if (channelResult.value.sendChannelTool) langchainTools.push(channelResult.value.sendChannelTool);
    } else {
        logger.warn({ error: channelResult.reason }, "Channel tool loading failed");
    }

    const store = storeResult.status === "fulfilled" ? storeResult.value : await getStore();

    // --- 7. System tools (sync — no I/O) ---
    const systemPermissions: SystemPermissions = {
        canManageKB: agent.canManageKB,
        canManageSkills: agent.canManageSkills,
        canManageTools: agent.canManageTools,
        canManageSchedules: agent.canManageSchedules,
        canManageChannels: agent.canManageChannels,
        canManageAgents: agent.canManageAgents,
        canManageBucket: agent.canManageBucket,
        canExecutePython: agent.canExecutePython,
    };

    if (agent.systemLevelAccess) {
        langchainTools.push(...buildSystemTools({ agentId, workspaceId, permissions: systemPermissions }));
    }

    // --- 7a. CEO tools (only for CEO agents) ---
    if (agent.isCeo) {
        langchainTools.push(...buildCEOTools({ agentId, workspaceId }));
    }

    // --- 7a2. Tester tools (only for Tester agents) ---
    if (agent.isTester) {
        langchainTools.push(...buildTesterTools({ agentId, workspaceId }));
    }

    // --- 7b. Bucket tools (always enabled for all agents) ---
    langchainTools.push(...buildBucketTools({ workspaceId, agentId, sessionId: chatSessionId, agentFolder: agent.bucketFolder || undefined }));

    // --- 7b-2. Bucket ↔ Composio bridge tool (when agent has active integrations) ---
    if (composioToolCount > 0) {
        langchainTools.push(buildBucketComposioBridgeTool({ workspaceId }));
    }

    // --- 7c. Python execution tools (always enabled for all agents) ---
    langchainTools.push(...buildPythonTools({
        workspaceId,
        userId,
        hasBucketAccess: true,
    }));

    // --- 8. Memory & notebook tools ---
    if (userId) {
        langchainTools.push(...buildMemoryTools({ workspaceId, agentId, userId }));
        langchainTools.push(...buildNotebookTools({ store, workspaceId, agentId, userId }));
    }

    // --- 8a. Workspace user info tool ---
    langchainTools.push(...buildWorkspaceUserTools({ workspaceId }));

    // --- 8b. Planning tools ---
    let currentTodos: Todo[] = [];
    const planningTools = buildPlanningTools(
        () => currentTodos,
        (todos) => { currentTodos = todos; }
    );
    langchainTools.push(...planningTools);

    // --- 8b2. Workflow tools ---
    let currentTrace: TraceStep[] = [];
    langchainTools.push(...buildWorkflowTools({
        workspaceId,
        agentId,
        getTrace: () => currentTrace,
    }));

    // --- 8c. Decision confirmation tool (human-in-the-loop) ---
    const askUserConfirmationTool = new DynamicStructuredTool({
        name: "ask_user_confirmation",
        description:
            "Ask the user to confirm before taking a significant action. " +
            "Use this before sending messages, deleting resources, creating system resources, " +
            "or making any irreversible change. Present a clear, human-readable question.",
        schema: z.object({
            question: z.string().describe("A clear question for the user. E.g. 'Should I send this message to John on Telegram?'"),
            context: z.string().optional().describe("Additional context to show the user — draft content, what will be deleted, etc."),
        }),
        func: async () => {
            // Execution is handled by the tool node via interrupt — this is never called directly
            return "Confirmation processed.";
        },
    });
    langchainTools.push(askUserConfirmationTool);

    // --- Build capability-aware system prompt ---
    const capabilities: AgentCapabilities = {
        kbs: kbCapabilities,
        skills: skillCapabilities,
        tools: toolCapabilities,
        mcpServers: mcpServerCapabilities,
        hasBrowser,
        hasExtensionBrowser: browserType === "extension" && hasBrowser,
        browserProfileName: browserProfile?.name,
        connectedAgents,
        composioIntegrations,
        channels: channelInfos,
        systemLevelAccess: agent.systemLevelAccess,
        systemPermissions,
        bucketFolder: agent.bucketFolder || undefined,
    };

    // For CEO/Tester agents, use their specialized system prompts
    const baseSystemPrompt = agent.isCeo
        ? CEO_SYSTEM_PROMPT + "\n\n" + buildSystemPrompt(
            { name: "CEO", role: "Workspace CEO — strategic manager", description: "" },
            capabilities
        )
        : agent.isTester
        ? TESTER_SYSTEM_PROMPT + "\n\n" + buildSystemPrompt(
            { name: "Tester", role: "Workspace QA Engineer — agent testing", description: "" },
            capabilities
        )
        : buildSystemPrompt(
            {
                name: agent.name,
                role: agent.systemPrompt?.split("\n")[0] || "",
                description: agent.systemPrompt || "",
            },
            capabilities
        );

    logger.info(
        {
            agentId,
            modelId,
            modelMultiplier,
            toolCount: langchainTools.length,
            delegateAgents: connectedAgents.length,
            composioTools: composioToolCount,
            kbCount: allowedKbIds.length,
            skillCount: permittedSkills.length,
            systemAccess: agent.systemLevelAccess,
        },
        "Agent graph created"
    );

    // Populate debug info cache for the debug panel
    debugInfoCache.set(cacheKey, {
        agentName: agent.name,
        agentId,
        modelId,
        modelDisplayName: resolvedModel.displayName,
        temperature: agentTemperature,
        systemPrompt: baseSystemPrompt,
        tools: langchainTools.map((t) => ({
            name: t.name,
            description: t.description || "",
            type: t.name.startsWith("agent_") ? "agent" : "tool",
        })),
        capabilities: {
            kbCount: kbCapabilities.length,
            skillCount: skillCapabilities.length,
            toolCount: toolCapabilities.length,
            mcpServerCount: mcpServerCapabilities.length,
            hasBrowser,
            hasExtensionBrowser: browserType === "extension" && hasBrowser,
            connectedAgentCount: connectedAgents.length,
            composioIntegrationCount: composioIntegrations.length,
            channelCount: channelInfos.length,
            systemLevelAccess: agent.systemLevelAccess,
        },
        kbs: kbCapabilities,
        skills: skillCapabilities,
        mcpServers: mcpServerCapabilities.map((m) => ({ name: m.name, toolNames: m.toolNames })),
        connectedAgents: connectedAgents.map((a) => ({ name: a.name, role: a.role })),
        composioIntegrations: composioIntegrations.map((i) => ({ app: i.app, connectionLabel: i.connectionLabel })),
        channels: channelInfos.map((c) => ({ name: c.name, channelType: c.channelType })),
        timestamp: Date.now(),
    });

    // Bind tools to LLM
    const llmWithTools = langchainTools.length > 0
        ? llm.bindTools(langchainTools)
        : llm;

    // Build skills section once
    let skillsSection = "";
    if (permittedSkills.length > 0) {
        const skillLines = permittedSkills
            .map((s) => `- ${s.name}: ${s.instructions}`)
            .join("\n");
        skillsSection = `\n\nSkills you must apply:\n${skillLines}`;
    }

    const agentNode = async (state: typeof AgentState.State, config: RunnableConfig) => {
        // Sync planning state from graph state
        currentTodos = state.todos || [];

        // Track iteration count for graceful termination
        const stepCount = (state.step_count ?? 0) + 1;

        const estimatedCost = calculateCreditCost({
            action: "chat_message",
            modelMultiplier,
        });

        // Extract latest user message for KB query and procedural memory semantic search
        const lastUserMsg = [...state.messages].reverse().find((m) => m instanceof HumanMessage);
        const lastUserMsgContent =
            lastUserMsg && typeof lastUserMsg.content === "string"
                ? lastUserMsg.content
                : null;

        // Collect tool names for procedural memory lookup
        const agentToolNames = langchainTools.map((t) => t.name);

        // --- Run credit check, memories, notebook, procedural memory, and KB query in PARALLEL ---
        const [creditCheck, memories, notebookSection, proceduralMemorySection, kbResults] = await Promise.all([
            checkCredits(workspaceId, estimatedCost),
            userId
                ? memoryRepository
                      .findByUser(workspaceId, agentId, userId)
                      .catch((error) => {
                          logger.warn({ error }, "Failed to load long-term memories");
                          return [] as Awaited<ReturnType<typeof memoryRepository.findByUser>>;
                      })
                : Promise.resolve([] as Awaited<ReturnType<typeof memoryRepository.findByUser>>),
            userId
                ? loadNotebookEntries({ store, workspaceId, agentId, userId })
                : Promise.resolve(""),
            loadProceduralMemory(store, workspaceId, agentToolNames, lastUserMsgContent ?? undefined),
            lastUserMsgContent && allowedKbIds.length > 0
                ? kbService
                      .queryKB(allowedKbIds, lastUserMsgContent, workspaceId, 5)
                      .catch((error) => {
                          logger.warn({ error, agentId }, "KB query failed, proceeding without context");
                          return [] as Awaited<ReturnType<typeof kbService.queryKB>>;
                      })
                : Promise.resolve([] as Awaited<ReturnType<typeof kbService.queryKB>>),
        ]);

        if (!creditCheck.allowed) {
            const errorMsg = `Insufficient credits. Available: ${creditCheck.available}. Required: ~${estimatedCost}. Top up at Settings > Billing.`;
            return { messages: [new AIMessage(errorMsg)], todos: currentTodos };
        }

        // Build system prompt — split into stable (cacheable) and dynamic parts.
        // Stable parts don't change between turns: agent identity, tools, instructions.
        // Dynamic parts change per turn: memories, KB results, tool history, plan state.
        // This enables prompt caching on Anthropic models (90% input cost savings on cache hits).
        const stableParts: string[] = [];
        const dynamicParts: string[] = [];

        // ── Stable parts (cacheable — identical across all turns in a session) ──

        // Capability-aware system prompt (agent identity, core behavior, tools, integrations, etc.)
        stableParts.push(baseSystemPrompt);

        // Skills instructions
        if (skillsSection) {
            stableParts.push(skillsSection);
        }

        // Artifact generation instructions
        stableParts.push(`## File & Document Generation

When the user asks you to create, write, or generate any document,
report, file, spreadsheet, webpage, or content — respond using
an artifact block.

Format:
<artifact type="TYPE" filename="FILENAME">
CONTENT
</artifact>

Supported types and when to use them:
- html → webpages, styled reports, dashboards, emails
- markdown → documentation, notes, READMEs, reports
- mdx → rich docs with components
- txt → plain text, logs, config files, scripts
- csv → tabular data, exports, datasets
- xlsx → spreadsheets (output as CSV inside the artifact — frontend converts)
- pdf → formal documents (output as HTML inside artifact — frontend converts)

Rules:
- ALWAYS use an artifact when generating file content
- Put the artifact tag at the END of your message
- You may write a brief message before the artifact (e.g. "Here's your report:")
- Never put the artifact inline inside a sentence
- For xlsx: output valid CSV inside the artifact, set type="xlsx"
- For pdf: output styled HTML inside the artifact, set type="pdf"
- Filename should be descriptive and lowercase with hyphens`);

        // Memory & Notebook capability instructions (static how-to, not the actual memory content)
        if (userId) {
            stableParts.push(`## Memory — IMPORTANT
You have a \`save_memory\` tool. You MUST use it aggressively to learn from every conversation. The user should NEVER have to repeat themselves.

### When to save (DO THIS EVERY TIME):
- **Processes & Workflows:** If the user explains how to do something step-by-step, save the ENTIRE process immediately. This is the most important type of memory.
- **Corrections:** If the user corrects you ("no, do it this way", "that's wrong"), save their correction as a process or preference so you never repeat the mistake.
- **Preferences & Rules:** How they want things done, formatting rules, communication style, tools they prefer.
- **Facts:** Names, roles, project details, technical stack, team structure, important context.
- **Decisions:** Choices made, reasons behind them, trade-offs considered.

### How to save:
- Write memories as **detailed, standalone statements** that your future self can act on without any other context.
- For processes, include ALL steps in order with enough detail to execute them independently.
- Use category "process" for workflows/instructions, "preference" for how they like things, "fact" for information, "decision" for choices made.
- BAD: "User told me about deployment" — too vague, useless.
- GOOD: "Deployment process: 1) Run 'npm test' 2) Build with 'docker build -t app .' 3) Push to staging with 'kubectl apply -f staging.yaml' 4) Wait for user approval 5) Push to production with 'kubectl apply -f prod.yaml'"

### How to use saved memories:
- Your previously saved memories are included at the top of this prompt. READ THEM CAREFULLY before every response.
- If a saved memory describes a process relevant to the user's current request, FOLLOW IT exactly without asking.
- If a saved memory contains a preference, APPLY IT automatically.
- If you're unsure whether a memory applies, follow it — the user saved it for a reason.

### Rule: When in doubt, SAVE IT. It's better to save too much than to forget something the user told you.`);

            stableParts.push(`## Notebook — Your Persistent Scratchpad
You have notebook tools (\`write_notebook\`, \`read_notebook\`, \`list_notebook\`, \`delete_notebook_entry\`) for saving working references that persist across all sessions.

### Notebook vs Memory — When to use which:
- **save_memory** → Facts *about the user*: preferences, processes, decisions, corrections
- **write_notebook** → Things *you discovered* during work: resource IDs, sheet names, API URLs, config values, last-processed positions

### When to write to notebook (DO THIS AUTOMATICALLY):
- You **looked up** a resource ID (Google Sheet ID, document ID, database record ID) → save it immediately
- You **discovered** an API endpoint, URL, or service address → save it
- You are **working through data** and need to track position (e.g. last row processed) → save it
- You found a **name-to-ID mapping** you'll need again (e.g. "Leads Sheet" → "1Bxi...") → save it
- You **successfully used a Composio tool slug** → save the slug + parameter pattern (e.g. key: \`composio_gmail_list\`, value: \`"slug: GMAIL_LIST_EMAILS, params: {max_results, label_ids, q}"\`) so you can skip COMPOSIO_SEARCH_TOOLS next time
- You **created or used a bucket CSV table** as a database → save with key \`bucket_db_{table_name}\` including filename, column schema, and purpose so you can find and use it in future sessions
- Any **operational reference** you'd lose if the conversation restarted → save it

### Before searching for resources:
- ALWAYS check your notebook first (entries are shown at the top of this prompt)
- If a notebook entry has the ID you need, use it directly — do NOT search again
- If the notebook is empty or doesn't have what you need, search normally and then save the result

### Key format:
- Use descriptive snake_case keys: \`leads_sheet_id\`, \`email_template_doc_id\`, \`crm_api_base\`
- For bucket database tables: \`bucket_db_leads\`, \`bucket_db_tasks\`, \`bucket_db_inventory\`
- Include a brief description when saving so future-you knows what it's for`);
        }

        // ── Dynamic parts (change between turns) ──

        // Conversation summary from earlier messages
        if (state.summary) {
            dynamicParts.push(
                `## Conversation Summary (earlier messages)\n${state.summary}`
            );
        }

        // Notebook entries (persistent working context)
        if (notebookSection) {
            dynamicParts.push(notebookSection);
        }

        // Procedural memory (agent-level learnings from past reflections)
        if (proceduralMemorySection) {
            dynamicParts.push(proceduralMemorySection);
        }

        // Long-term memories for this user
        if (memories.length > 0) {
            const processMemories = memories.filter((m) => m.category === "process");
            const otherMemories = memories.filter((m) => m.category !== "process");

            const memoryParts: string[] = [];

            if (processMemories.length > 0) {
                const processLines = processMemories
                    .map((m) => `- ${m.content}`)
                    .join("\n");
                memoryParts.push(
                    `### Learned Processes & Workflows (FOLLOW THESE)\n` +
                    `These are processes the user taught you. When a request matches one of these, follow it exactly:\n${processLines}`
                );
            }

            if (otherMemories.length > 0) {
                const otherLines = otherMemories
                    .map((m) => `- [${m.category}] ${m.content}`)
                    .join("\n");
                memoryParts.push(
                    `### User Facts & Preferences\n${otherLines}`
                );
            }

            dynamicParts.push(
                `## Long-term Memories About This User\n` +
                `⚠️ You MUST read and apply these memories. They represent things this user has already told you.\n\n` +
                memoryParts.join("\n\n")
            );
        }

        // KB context (RAG) — with credit deduction
        if (kbResults.length > 0) {
            const context = kbResults
                .map((r) => r.content)
                .join("\n\n---\n\n");
            dynamicParts.push(
                `Relevant context from knowledge base:\n${context}`
            );
            // Deduct KB query credits (fire-and-forget)
            deductCredits({
                workspaceId,
                amount: calculateCreditCost({ action: "kb_query" }),
                type: "kb_query",
                metadata: { agentId, kbIds: allowedKbIds },
            }).catch((err) =>
                logger.warn({ err }, "KB query credit deduction failed")
            );
        }

        // Current plan state
        if (currentTodos.length > 0) {
            const completed = currentTodos.filter((t) => t.status === "completed").length;
            const todoLines = currentTodos.map((t, i) => {
                const icon = t.status === "completed" ? "done" : t.status === "in_progress" ? "..." : " ";
                return `${i + 1}. [${icon}] ${t.title}${t.result ? ` → ${t.result}` : ""}`;
            }).join("\n");
            const nextPending = currentTodos.find((t) => t.status === "pending");
            const inProgress = currentTodos.find((t) => t.status === "in_progress");
            let instruction = "";
            if (inProgress) {
                instruction = `Step "${inProgress.title}" is in_progress. Complete it and call \`update_todo("${inProgress.id}", "completed", "<result>")\` when done.`;
            } else if (nextPending) {
                instruction = `Next step: "${nextPending.title}". Execute it and update its status as you progress.`;
            } else {
                instruction = `All steps completed. Summarize results to the user.`;
            }
            dynamicParts.push(
                `## Current Plan (${completed}/${currentTodos.length} completed)\n${todoLines}\n\n` +
                `${instruction}\n` +
                `Tip: You can combine \`update_todo\` with other tool calls in the same turn to be efficient.`
            );
        }

        // Tool usage history so LLM avoids repeating mistakes
        const toolUsageSummary = buildToolUsageSummary(state.messages);
        if (toolUsageSummary) {
            dynamicParts.push(toolUsageSummary);
        }

        // Step budget awareness when approaching the limit
        const isApproachingLimit = stepCount >= MAX_TOOL_ITERATIONS - 3;
        if (isApproachingLimit) {
            const remaining = MAX_TOOL_ITERATIONS - stepCount;
            dynamicParts.push(
                `## ⚠️ STEP BUDGET WARNING\n` +
                `You have used ${stepCount} of ${MAX_TOOL_ITERATIONS} tool iterations. ` +
                `You have ${remaining} iteration(s) remaining.\n` +
                `Wrap up your current work NOW. Provide your best response with the information gathered so far. ` +
                `Only call a tool if it is the FINAL action needed to complete the task.`
            );
        }

        // ── Build SystemMessage with prompt caching for Anthropic models ──
        // For Anthropic models (direct or via OpenRouter), we split into two content blocks:
        //   1. Stable block with cache_control — cached across turns (~90% input cost savings)
        //   2. Dynamic block without cache_control — processed fresh each turn
        // For ChatAnthropic (direct): cache_control is passed natively.
        // For ChatOpenAI (OpenRouter): cache_control is stripped by LangChain but re-injected
        //   by the custom fetch wrapper in gateway.ts (createCacheControlFetch).
        // For non-Anthropic models: single string, no cache_control (they use automatic caching).
        const stableText = stableParts.join("\n\n");
        const dynamicText = dynamicParts.join("\n\n");

        const systemMsg = supportsPromptCaching
            ? new SystemMessage({
                content: [
                    {
                        type: "text" as const,
                        text: stableText,
                        // cache_control is either passed natively (ChatAnthropic) or
                        // re-injected by the custom fetch wrapper (ChatOpenAI + OpenRouter)
                        ...(isClaudeDirect ? { cache_control: { type: "ephemeral" } } : {}),
                    },
                    ...(dynamicText
                        ? [{ type: "text" as const, text: dynamicText }]
                        : []),
                ],
            })
            : new SystemMessage(
                stableText + (dynamicText ? "\n\n" + dynamicText : "")
            );
        let response;
        try {
            const sanitizedMessages = sanitizeMessagesForProvider(state.messages);
            logger.info({
                messageCount: state.messages.length,
                sanitizedMessageCount: sanitizedMessages.length,
                systemPromptLength: stableText.length + (dynamicText ? dynamicText.length + 2 : 0),
                stablePromptLength: stableText.length,
                dynamicPromptLength: dynamicText.length,
                promptCaching: supportsPromptCaching,
                toolCount: langchainTools.length,
                isClaudeDirect,
                modelId,
                stepCount,
                maxToolIterations: MAX_TOOL_ITERATIONS,
                lastMessageType: state.messages[state.messages.length - 1]?.constructor?.name,
            }, "Invoking LLM");
            response = await llmWithTools.invoke([systemMsg, ...sanitizedMessages], config);

            // Debug: log what the model returned
            const aiResponse = response as AIMessage;
            const responseToolCalls = aiResponse.tool_calls ?? [];
            const responseContent = typeof aiResponse.content === "string"
                ? aiResponse.content
                : Array.isArray(aiResponse.content)
                    ? (aiResponse.content as Array<{ type: string; text?: string }>)
                        .filter(b => b.type === "text")
                        .map(b => b.text ?? "")
                        .join("")
                    : "";

            // --- Recover tool calls output as text (Claude intermittent issue) ---
            // Claude sometimes serializes tool calls as JSON text (e.g.
            // {"tool_calls":[{"name":"TOOL","input":{...}}]}) instead of using
            // the API's native tool_use blocks. Detect this and convert to proper
            // tool_calls so the graph routes to the tool node correctly.
            if (responseToolCalls.length === 0 && responseContent.length > 0 && langchainTools.length > 0) {
                const availableToolNames = new Set(langchainTools.map(t => t.name));
                const recovered = recoverToolCallsFromText(aiResponse.content, availableToolNames);
                if (recovered) {
                    logger.warn({
                        recoveredCount: recovered.toolCalls.length,
                        toolNames: recovered.toolCalls.map(tc => tc.name),
                        originalContentPreview: responseContent.slice(0, 200),
                    }, "Recovered tool calls from text — model serialized tool calls as JSON instead of using API tool_use");
                    response = new AIMessage({
                        content: recovered.cleanedContent,
                        tool_calls: recovered.toolCalls,
                    });
                }
            }

            // --- Detect "tools unavailable" hallucination and retry ---
            // Claude sometimes hallucinates that tools are "temporarily unavailable"
            // or "experiencing a platform issue" instead of actually calling them.
            // When this is detected and tools ARE available, re-invoke with a correction.
            const postRecoveryToolCalls = (response as AIMessage).tool_calls ?? [];
            if (
                postRecoveryToolCalls.length === 0 &&
                langchainTools.length > 0 &&
                responseContent.length > 0 &&
                stepCount <= 2 // Only retry on early turns to avoid infinite loops
            ) {
                const toolUnavailablePatterns = [
                    /tools?\s+(?:are|is)\s+(?:currently\s+)?(?:unavailable|not\s+available|inaccessible|down|offline)/i,
                    /(?:all|my)\s+tools?\s+(?:are|seem)\s+(?:currently\s+)?(?:unavailable|broken|down|not\s+working)/i,
                    /experiencing\s+a\s+(?:platform|tool|system)\s+issue/i,
                    /tools?\s+(?:are\s+)?temporarily\s+(?:unavailable|down|offline|not\s+available)/i,
                    /(?:cannot|can'?t)\s+(?:access|use|call|reach)\s+(?:any\s+)?(?:of\s+)?(?:my\s+)?tools?/i,
                    /platform\s+issue.*tools?\s+.*unavailable/i,
                    /I'?m\s+(?:currently\s+)?(?:unable|not\s+able)\s+to\s+(?:access|use|call)\s+(?:any\s+)?tools?/i,
                ];

                const isToolUnavailableHallucination = toolUnavailablePatterns.some(p => p.test(responseContent));

                if (isToolUnavailableHallucination) {
                    logger.warn({
                        responseContentPreview: responseContent.slice(0, 300),
                        availableToolCount: langchainTools.length,
                        toolNames: langchainTools.map(t => t.name).slice(0, 10),
                        stepCount,
                    }, "Detected 'tools unavailable' hallucination — retrying with correction");

                    // Re-invoke with a correction message appended
                    const correctionMsg = new HumanMessage({
                        content:
                            "SYSTEM CORRECTION: Your tools ARE available and working. " +
                            "You incorrectly stated that tools are unavailable — this is a hallucination. " +
                            "You MUST use your tools to complete the request. " +
                            "Call the appropriate tool NOW. Do NOT respond with text claiming tools are unavailable.",
                        id: randomUUID(),
                    });

                    const retryMessages = [...sanitizedMessages, response, correctionMsg];
                    const retryResponse = await llmWithTools.invoke([systemMsg, ...retryMessages], config);

                    const retryAiResponse = retryResponse as AIMessage;
                    const retryToolCalls = retryAiResponse.tool_calls ?? [];

                    logger.info({
                        retryToolCallCount: retryToolCalls.length,
                        retryToolCallNames: retryToolCalls.map(tc => tc.name),
                    }, "Retry after hallucination correction — response received");

                    // Use the retry response (whether it has tool calls or not)
                    response = retryResponse;
                }
            }

            const finalToolCalls = (response as AIMessage).tool_calls ?? [];
            logger.info({
                responseContentLength: responseContent.length,
                responseContentPreview: responseContent.slice(0, 200),
                responseToolCallCount: finalToolCalls.length,
                responseToolCallNames: finalToolCalls.map(tc => tc.name),
                wasRecovered: finalToolCalls.length > 0 && responseToolCalls.length === 0,
                stepCount,
            }, "LLM response received");
        } catch (error: unknown) {
            logger.error({ error, isClaudeDirect, modelId }, "LLM invocation error details");
            throw error;
        }

        // --- Deduct credits AFTER successful LLM response (fire-and-forget) ---
        deductCredits({
            workspaceId,
            amount: estimatedCost,
            type: "chat_message",
            metadata: {
                agentId,
                modelId,
                multiplier: modelMultiplier,
                baseCredits: 5,
                finalCredits: estimatedCost,
            },
        }).catch((err) =>
            logger.warn({ err }, "Chat message credit deduction failed")
        );

        return { messages: [response], todos: currentTodos, step_count: stepCount };
    };

    // Summarization node — compresses older messages into a summary
    const summarizeConversation = async (state: typeof AgentState.State, config: RunnableConfig) => {
        const { summary, messages } = state;

        let summaryPrompt: string;
        if (summary) {
            summaryPrompt =
                `This is a summary of the conversation to date: ${summary}\n\n` +
                `Extend the summary by taking into account the new messages above. ` +
                `Preserve all important facts, user preferences, decisions, and context:`;
        } else {
            summaryPrompt =
                `Create a concise summary of the conversation above. ` +
                `Preserve all important facts, user preferences, decisions, and context:`;
        }

        const allMessages = [
            ...sanitizeMessagesForProvider(messages),
            new HumanMessage({ id: randomUUID(), content: summaryPrompt }),
        ];

        const response = await llm.invoke(allMessages, config);

        // Keep the last N messages, but walk boundary back to avoid splitting tool call/response pairs
        let boundary = messages.length - KEEP_MESSAGES;
        if (boundary > 0) {
            // Walk back until we land on a HumanMessage (safe split point)
            while (boundary > 0 && !(messages[boundary] instanceof HumanMessage)) {
                boundary--;
            }
        }
        if (boundary <= 0) boundary = 0;

        const deleteMessages = messages
            .slice(0, boundary)
            .filter((m) => m.id)
            .map((m) => new RemoveMessage({ id: m.id! }));

        const summaryContent =
            typeof response.content === "string"
                ? response.content
                : Array.isArray(response.content)
                    ? response.content
                        .filter((b: { type: string }) => b.type === "text")
                        .map((b: { text: string }) => b.text)
                        .join("")
                    : "";

        return { summary: summaryContent, messages: deleteMessages };
    };

    // Reflection node — automatically extracts learnings from user corrections and tool failures.
    // Runs after the agent's final response has been streamed to the user, so it does NOT add
    // perceived latency. Only invokes an LLM call when correction signals are detected.
    // Learnings are stored per-tool so any agent in the workspace using that tool benefits.
    const reflectAndLearn = async (state: typeof AgentState.State, config: RunnableConfig) => {
        // Skip if too few messages (need enough conversation for meaningful reflection)
        if (state.messages.length < 6) {
            return {};
        }

        // Quick scan — skip the expensive LLM call if no corrections/failures detected
        if (!detectCorrectionSignals(state.messages)) {
            return {};
        }

        // Collect tool names used in this conversation from tool call history
        const toolNamesUsed = new Set<string>();
        for (const msg of state.messages) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const toolCalls = (msg as any).tool_calls;
            if (Array.isArray(toolCalls)) {
                for (const tc of toolCalls as Array<{ name: string }>) {
                    toolNamesUsed.add(tc.name);
                }
            }
        }

        // Also include all agent tools as valid targets for the LLM to tag
        const allToolNames = [...new Set([...toolNamesUsed, ...langchainTools.map((t) => t.name)])];

        try {
            // Load existing learnings across all tool namespaces to avoid duplicates
            const existingLearnings: string[] = [];
            for (const toolName of toolNamesUsed) {
                const namespace = [workspaceId, "tool_learnings", toolName];
                const items = await store.search(namespace, { limit: 20 });
                for (const item of items) {
                    existingLearnings.push(`[${toolName}] ${item.value.learning}`);
                }
            }

            const existingBlock = existingLearnings.length > 0
                ? `Existing learnings (DO NOT duplicate these):\n${existingLearnings.map((l) => `- ${l}`).join("\n")}`
                : "(no existing learnings yet)";

            const reflectionPrompt = new SystemMessage(
                `You are a reflection engine. Analyze this conversation and extract SPECIFIC, ACTIONABLE learnings from:\n` +
                `1. User corrections ("no, do it this way", "that's wrong", "I meant...")\n` +
                `2. Tool call failures that were later resolved with a different approach\n` +
                `3. Misunderstandings that were clarified by the user\n\n` +
                `${existingBlock}\n\n` +
                `Tools available in this conversation: ${allToolNames.join(", ")}\n\n` +
                `Output ONLY new learnings as a JSON array of objects with "tool" and "learning" fields.\n` +
                `- "tool": the exact tool name the learning applies to (must be from the list above)\n` +
                `- "learning": a specific, actionable instruction written as "When X, do Y" or "Always/Never do X when Y"\n` +
                `- Each learning must be grounded in what actually happened — no generic platitudes\n\n` +
                `Example output:\n` +
                `[{"tool": "COMPOSIO_MULTI_EXECUTE_TOOL", "learning": "When sending Gmail, use GMAIL_SEND_EMAIL slug with html_message param, not plain body"},` +
                ` {"tool": "google_sheets_read", "learning": "Always specify sheet name explicitly — default sheet may not be the first tab"}]\n\n` +
                `If there are NO genuinely new learnings, output: []`
            );

            const sanitized = sanitizeMessagesForProvider(state.messages);
            const response = await llm.invoke([reflectionPrompt, ...sanitized], config);
            const content = typeof response.content === "string" ? response.content : "";

            // Parse JSON array from response
            const match = content.match(/\[[\s\S]*\]/);
            if (!match) return {};

            const learnings = JSON.parse(match[0]) as Array<{ tool: string; learning: string }>;
            if (!Array.isArray(learnings) || learnings.length === 0) return {};

            // Save each learning under its tool's namespace
            let savedCount = 0;
            for (const entry of learnings) {
                if (
                    typeof entry.tool === "string" &&
                    typeof entry.learning === "string" &&
                    entry.learning.trim().length > 10
                ) {
                    const namespace = [workspaceId, "tool_learnings", entry.tool];
                    await store.put(
                        namespace,
                        randomUUID(),
                        {
                            learning: entry.learning.trim(),
                            extractedAt: new Date().toISOString(),
                            sourceAgentId: agentId,
                        },
                        ["learning"], // Embed the learning field for semantic search
                    );
                    savedCount++;
                }
            }

            logger.info(
                { agentId, workspaceId, newLearnings: savedCount, tools: [...toolNamesUsed] },
                "Reflection node: extracted tool-scoped procedural learnings"
            );
        } catch (error) {
            // Non-fatal — reflection failure should never break the conversation
            logger.warn({ error, agentId }, "Reflection node: failed to extract learnings");
        }

        // --- Workflow pattern detection ---
        // Track tool call sequences to suggest workflow compilation when patterns repeat
        try {
            const trace = state.execution_trace || [];
            if (trace.length >= 3) {
                const toolSequence = trace.filter(s => s.succeeded).map(s => s.tool).join(" -> ");
                if (toolSequence) {
                    const ns = [workspaceId, "workflow_suggestions"];
                    const existing = await store.search(ns, { limit: 50 });
                    const matchCount = existing.filter(item => item.value.sequence === toolSequence).length;

                    if (matchCount === 0) {
                        // First time seeing this sequence — store it
                        await store.put(ns, randomUUID(), {
                            sequence: toolSequence,
                            agentId,
                            stepCount: trace.filter(s => s.succeeded).length,
                            detectedAt: new Date().toISOString(),
                        });
                    } else if (matchCount >= 2) {
                        // Seen 3+ times — store a suggestion flag
                        await store.put(ns, `suggest-${agentId}`, {
                            sequence: toolSequence,
                            agentId,
                            count: matchCount + 1,
                            suggestion: `This tool sequence has been run ${matchCount + 1} times. Consider saving it as a workflow with save_as_workflow.`,
                            detectedAt: new Date().toISOString(),
                        });
                        logger.info({ agentId, sequence: toolSequence, count: matchCount + 1 }, "Workflow suggestion: repeated pattern detected");
                    }
                }
            }
        } catch (error) {
            logger.warn({ error, agentId }, "Reflection node: failed to detect workflow patterns");
        }

        return {};
    };

    // Route function — decides: tools, final_answer, summarize, or end
    const shouldContinue = (state: typeof AgentState.State) => {
        const lastMessage = state.messages[state.messages.length - 1];
        const hasToolCalls = lastMessage &&
            "tool_calls" in lastMessage &&
            (lastMessage as AIMessage).tool_calls &&
            (lastMessage as AIMessage).tool_calls!.length > 0;

        // Check step budget BEFORE routing to tools
        if (hasToolCalls && (state.step_count ?? 0) >= MAX_TOOL_ITERATIONS) {
            logger.warn({
                route: "final_answer",
                stepCount: state.step_count,
                maxToolIterations: MAX_TOOL_ITERATIONS,
                pendingToolCalls: (lastMessage as AIMessage).tool_calls!.map(tc => tc.name),
            }, "shouldContinue → final_answer (step budget exhausted, LLM still requesting tools)");
            return "final_answer";
        }

        if (hasToolCalls) {
            logger.info({
                route: "tools",
                toolCallCount: (lastMessage as AIMessage).tool_calls!.length,
                toolCallNames: (lastMessage as AIMessage).tool_calls!.map(tc => tc.name),
                messageCount: state.messages.length,
                stepCount: state.step_count,
            }, "shouldContinue → tools");
            return "tools";
        }
        // Check if conversation is long enough to warrant summarization
        if (state.messages.length > SUMMARIZE_THRESHOLD) {
            logger.info({ route: "summarize", messageCount: state.messages.length }, "shouldContinue → summarize");
            return "summarize_conversation";
        }
        // End the graph — reflection runs post-stream (fire-and-forget) so [DONE] is not blocked
        logger.info({
            route: "__end__",
            messageCount: state.messages.length,
            stepCount: state.step_count,
            lastMessageType: lastMessage?.constructor?.name,
        }, "shouldContinue → __end__");
        return "__end__";
    };

    // Final answer node — invoked when step budget is exhausted.
    // Calls the LLM WITHOUT tools so it MUST produce a text response
    // synthesizing everything gathered during the run.
    const finalAnswerNode = async (state: typeof AgentState.State, config: RunnableConfig) => {
        logger.info({
            stepCount: state.step_count,
            messageCount: state.messages.length,
        }, "Final answer node: generating summary response (step budget exhausted)");

        const sanitizedMessages = sanitizeMessagesForProvider(state.messages);

        // Build a minimal system prompt for the final answer
        const finalSystemMsg = new SystemMessage(
            `You are ${agent.name}. You were working on a task and have reached the maximum number of processing steps.\n\n` +
            `Review the entire conversation above — including all tool results you have gathered — and provide your FINAL answer to the user.\n` +
            `Synthesize all the information you collected into a clear, complete response.\n` +
            `If the task is partially complete, clearly state what was accomplished and what remains.\n` +
            (state.summary ? `\nConversation summary (earlier messages): ${state.summary}\n` : "")
        );

        // Use the LLM WITHOUT tools bound — forces a text-only response
        const response = await llm.invoke([finalSystemMsg, ...sanitizedMessages], config);

        logger.info({
            responseLength: typeof response.content === "string" ? response.content.length : 0,
        }, "Final answer node: response generated");

        return { messages: [response], step_count: state.step_count };
    };

    // --- Custom HITL tool node (replaces ToolNode) ---
    const toolsByName = new Map<string, DynamicStructuredTool>();
    for (const tool of langchainTools) {
        toolsByName.set(tool.name, tool);
    }

    const humanReviewToolNode = async (state: typeof AgentState.State) => {
        // Sync planning state and execution trace so tools can read/write them
        currentTodos = state.todos || [];
        currentTrace = state.execution_trace || [];
        const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
        const toolCalls = lastMessage.tool_calls ?? [];

        logger.info({
            toolCallCount: toolCalls.length,
            toolCallNames: toolCalls.map(tc => tc.name),
            messageCount: state.messages.length,
        }, "Tool node executing");

        const results: ToolMessage[] = [];
        const traceSteps: TraceStep[] = [];

        for (const tc of toolCalls) {
            // Decision confirmation — interrupt for user approval
            if (tc.name === "ask_user_confirmation") {
                const response = interrupt({
                    type: "confirmation",
                    question: tc.args.question as string,
                    context: tc.args.context as string | undefined,
                }) as { decisions: Array<{ type: string; message?: string }> };

                const decision = response.decisions?.[0] || { type: "approve" };

                if (decision.type === "reject") {
                    results.push(new ToolMessage({
                        content: `User rejected this action.${decision.message ? ` Reason: ${decision.message}` : ""} Do not proceed with the proposed action.`,
                        tool_call_id: tc.id!,
                        name: tc.name,
                    }));
                } else {
                    results.push(new ToolMessage({
                        content: `User approved.${decision.message ? ` Note: ${decision.message}` : ""} Proceed with the action.`,
                        tool_call_id: tc.id!,
                        name: tc.name,
                    }));
                }
                continue;
            }

            // All other tools execute directly — no permission gates
            const tool = toolsByName.get(tc.name);
            if (!tool) {
                results.push(new ToolMessage({
                    content: `Tool "${tc.name}" not found`,
                    tool_call_id: tc.id!,
                    name: tc.name,
                }));
                continue;
            }

            const startMs = Date.now();
            try {
                const result = await tool.invoke(tc.args);
                const resultContent = typeof result === "string" ? result : JSON.stringify(result);
                const durationMs = Date.now() - startMs;
                logger.info({
                    toolName: tc.name,
                    resultLength: resultContent.length,
                    resultPreview: resultContent.slice(0, 300),
                    durationMs,
                }, "Tool executed successfully");
                results.push(new ToolMessage({
                    content: resultContent,
                    tool_call_id: tc.id!,
                    name: tc.name,
                }));
                traceSteps.push({
                    tool: tc.name,
                    args: tc.args as Record<string, unknown>,
                    output: resultContent.slice(0, 2000),
                    durationMs,
                    succeeded: true,
                    timestamp: new Date().toISOString(),
                });
            } catch (error) {
                const errMsg = `Error: ${error instanceof Error ? error.message : "Unknown error"}`;
                const durationMs = Date.now() - startMs;
                logger.error({ toolName: tc.name, error: errMsg }, "Tool execution failed");
                results.push(new ToolMessage({
                    content: errMsg,
                    tool_call_id: tc.id!,
                    name: tc.name,
                }));
                traceSteps.push({
                    tool: tc.name,
                    args: tc.args as Record<string, unknown>,
                    output: errMsg,
                    durationMs,
                    succeeded: false,
                    timestamp: new Date().toISOString(),
                });
            }
        }

        return { messages: results, todos: currentTodos, execution_trace: traceSteps };
    };

    // reflect_and_learn runs post-stream (fire-and-forget via runReflection below),
    // so it is NOT a graph node — this keeps [DONE] unblocked.
    const graph = new StateGraph(AgentState)
        .addNode("agent", agentNode)
        .addNode("summarize_conversation", summarizeConversation)
        .addNode("final_answer", finalAnswerNode);

    if (langchainTools.length > 0) {
        graph
            .addNode("tools", humanReviewToolNode)
            .addEdge("__start__", "agent")
            .addConditionalEdges("agent", shouldContinue)
            .addEdge("tools", "agent")
            .addEdge("final_answer", "__end__")
            .addEdge("summarize_conversation", "__end__");
    } else {
        graph
            .addEdge("__start__", "agent")
            .addConditionalEdges("agent", shouldContinue)
            .addEdge("final_answer", "__end__")
            .addEdge("summarize_conversation", "__end__");
    }

    const checkpointer = await getCheckpointer();

    const compiled = graph.compile({ checkpointer, store });

    // Standalone reflection runner — called by executeRun after [DONE] is emitted.
    // Captures the agent's LLM, store, and tool list from this closure.
    const runReflection = async (messages: BaseMessage[]): Promise<void> => {
        const fakeState = {
            messages,
            step_count: 0,
            summary: "",
            todos: [] as Todo[],
        } as typeof AgentState.State;
        await reflectAndLearn(fakeState, {} as RunnableConfig);
    };

    // Cache compiled graph for subsequent messages in this session
    graphCache.set(cacheKey, {
        graph: compiled,
        runReflection,
        browserEventRef,
        toolsByName,
        timestamp: Date.now(),
    });
    logger.info({ agentId, cacheKey }, "Agent graph compiled and cached");

    return { graph: compiled, runReflection };
}

/**
 * Get the tool map for an agent, reusing the graph cache.
 * Used by the workflow executor to call tools directly without an LLM loop.
 */
export async function getToolsForAgent(
    agentId: string,
    workspaceId: string,
): Promise<Map<string, DynamicStructuredTool>> {
    // Check cache first
    for (const [, entry] of graphCache) {
        if (Date.now() - entry.timestamp < GRAPH_CACHE_TTL_MS && entry.toolsByName.size > 0) {
            // Found a valid cached entry - check if it's for this agent
            // Cache keys are formatted as agentId:workspaceId:...
            return entry.toolsByName;
        }
    }

    // No cache hit — create the graph which populates the cache
    const { } = await createAgentGraph(agentId, workspaceId);

    // Now find the cache entry
    for (const [key, entry] of graphCache) {
        if (key.startsWith(`${agentId}:${workspaceId}:`)) {
            return entry.toolsByName;
        }
    }

    // Fallback: empty map (should not happen)
    return new Map();
}
