import { StateGraph, MessagesAnnotation } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { createLLM, refreshClaudeToken } from "../lib/gateway.ts";
import { SystemMessage, AIMessage } from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { z } from "zod";
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
import { HumanMessage } from "@langchain/core/messages";
import { buildBrowserTools } from "../tools/browser.tools.ts";
import { buildSystemTools } from "../tools/system.tools.ts";
import { buildSystemPrompt } from "../lib/system-prompt-builder.ts";
import { browserRepository } from "../repositories/browser.repository.ts";
import {
    checkCredits,
    deductCredits,
    calculateCreditCost,
    isPlanSufficient,
} from "../lib/credit-engine.ts";
import type {
    AgentCapabilities,
    KBCapability,
    SkillCapability,
    ToolCapability,
    MCPServerCapability,
    ConnectedAgent,
    ComposioIntegration,
    SystemPermissions,
} from "../lib/system-prompt-builder.ts";

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

function slugifyLabel(label: string): string {
    return label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "");
}

// For now, workspace plan is always "pro". Replace when subscription system is built.
function getWorkspacePlan(_workspaceId: string): string {
    return "pro";
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

export async function createAgentGraph(
    agentId: string,
    workspaceId: string
) {
    const agent = await agentRepository.findById(agentId, workspaceId);
    if (!agent) throw new Error("Agent not found");

    // --- Resolve model with plan gating ---
    const resolvedModel = await resolveModel(agent.model, workspaceId);
    const modelId = resolvedModel.modelId;
    const modelMultiplier = resolvedModel.multiplier;

    const agentTemperature = agent.temperature ?? 0.7;
    const { llm, isClaudeDirect, recreate: recreateLLM } = createLLM({
        modelId,
        temperature: agentTemperature,
    });

    // --- Fetch all capability data in parallel ---
    const [
        allowedToolIds,
        allowedAgentIds,
        allowedKbIds,
        allowedSkillIds,
        browserProfile,
        agentIntegrations,
    ] = await Promise.all([
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

    // --- 1. Function & MCP Tools ---
    if (allowedToolIds.length > 0) {
        const dbTools = await toolRepository.findByIds(allowedToolIds);

        for (const tool of dbTools) {
            const config = tool.config as Record<string, unknown>;

            if (tool.type === "function") {
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
                    if (!urlVars.includes(match[1])) {
                        urlVars.push(match[1]);
                    }
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
                            const value = params[v] as string;
                            resolvedUrl = resolvedUrl.replace(
                                new RegExp(`\\{\\{${v}\\}\\}`, "g"),
                                encodeURIComponent(value)
                            );
                        }

                        const controller = new AbortController();
                        const timeout = setTimeout(() => controller.abort(), 30_000);
                        try {
                            const fetchOptions: RequestInit = {
                                method,
                                signal: controller.signal,
                            };

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

                langchainTools.push(functionTool);
                toolCapabilities.push({
                    name: tool.name,
                    description: tool.description,
                    parameters: paramDesc,
                });
            } else if (tool.type === "mcp") {
                const mcpUrl = config.url as string;
                if (!mcpUrl) {
                    logger.warn({ toolId: tool.id }, "MCP tool missing URL, skipping");
                    continue;
                }

                try {
                    const mcpClient = new MultiServerMCPClient({
                        [tool.name]: {
                            url: mcpUrl,
                            transport: "sse",
                        },
                    });

                    const mcpToolsList = await mcpClient.getTools();
                    mcpClients.push(mcpClient);

                    const toolNames = config.toolNames as string[] | undefined;
                    const filtered = toolNames && toolNames.length > 0
                        ? mcpToolsList.filter((t) => toolNames.includes(t.name))
                        : mcpToolsList;

                    const mcpToolNames: string[] = [];
                    for (const mcpTool of filtered) {
                        langchainTools.push(mcpTool as DynamicStructuredTool);
                        mcpToolNames.push(mcpTool.name);
                    }

                    mcpServerCapabilities.push({
                        name: tool.name,
                        description: tool.description,
                        toolNames: mcpToolNames,
                    });
                } catch (error) {
                    logger.warn(
                        { error, toolId: tool.id, mcpUrl },
                        "Failed to connect to MCP server, skipping tool"
                    );
                }
            }
        }
    }

    // --- 2. Agent delegation tools ---
    const delegateAgentIds = allowedAgentIds.filter((id) => id !== agentId);
    const connectedAgents: ConnectedAgent[] = [];

    for (const targetAgentId of delegateAgentIds) {
        try {
            const targetAgent = await agentRepository.findById(targetAgentId, workspaceId);
            if (targetAgent) {
                const agentTool = await buildAgentCallerTool(
                    agentId,
                    targetAgentId,
                    workspaceId
                );
                if (agentTool) {
                    langchainTools.push(agentTool);
                    connectedAgents.push({
                        id: targetAgent.id,
                        name: targetAgent.name,
                        role: targetAgent.systemPrompt?.split("\n")[0] || "General Assistant",
                    });
                }
            }
        } catch (error) {
            logger.warn(
                { error, targetAgentId },
                "Failed to build agent caller tool, skipping"
            );
        }
    }

    // --- 3. Composio integration tools ---
    let composioToolCount = 0;
    const activeIntegrations = agentIntegrations.filter(
        (i) => i.status === "active"
    );

    if (activeIntegrations.length > 0) {
        try {
            const composio = getComposioClient();

            const slugToIntegrations = new Map<string, typeof activeIntegrations>();
            for (const integ of activeIntegrations) {
                const list = slugToIntegrations.get(integ.composioToolkitSlug) || [];
                list.push(integ);
                slugToIntegrations.set(integ.composioToolkitSlug, list);
            }

            const toolkitSlugs = [...new Set(activeIntegrations.map((i) => i.composioToolkitSlug))];

            const session = await composio.create(workspaceId, {
                toolkits: toolkitSlugs,
            });
            const composioTools = await session.tools();

            if (Array.isArray(composioTools)) {
                for (const integ of activeIntegrations) {
                    const slug = integ.composioToolkitSlug;
                    const label = integ.connectionLabel || integ.name;
                    const labelSlug = slugifyLabel(label);
                    const integrationsForSlug = slugToIntegrations.get(slug) || [];
                    const hasMultiple = integrationsForSlug.length > 1;

                    const slugTools = composioTools.filter(
                        (t: { name?: string }) =>
                            typeof t.name === "string" && t.name.toLowerCase().startsWith(slug.toLowerCase())
                    );

                    const actionNames: string[] = [];
                    for (const tool of slugTools) {
                        const castTool = tool as unknown as DynamicStructuredTool;
                        const originalName = castTool.name;

                        if (hasMultiple) {
                            const renamedTool = new DynamicStructuredTool({
                                name: `${originalName}__${labelSlug}`,
                                description: `${castTool.description} — Connection: '${label}'${integ.connectionDescription ? ` (${integ.connectionDescription})` : ""}`,
                                schema: castTool.schema,
                                func: castTool.func,
                            });
                            langchainTools.push(renamedTool);
                            actionNames.push(`${originalName}__${labelSlug}`);
                        } else {
                            langchainTools.push(castTool);
                            actionNames.push(originalName);
                        }
                    }

                    composioToolCount += slugTools.length;

                    const appDisplayName = slug.charAt(0).toUpperCase() + slug.slice(1);

                    composioIntegrations.push({
                        connectionLabel: label,
                        connectionDescription: integ.connectionDescription ?? undefined,
                        app: slug,
                        appDisplayName,
                        actions: actionNames,
                    });
                }
            }
        } catch (error) {
            logger.warn(
                { error, agentId },
                "Failed to load Composio tools, proceeding without them"
            );
        }
    }

    // --- 4. Browser tools (wrapped with credit deduction) ---
    let hasBrowser = false;
    try {
        const rawBrowserTools = await buildBrowserTools(agentId, workspaceId);
        if (rawBrowserTools.length > 0) {
            // Wrap each browser tool to deduct credits per action
            for (const bt of rawBrowserTools) {
                const wrappedTool = new DynamicStructuredTool({
                    name: bt.name,
                    description: bt.description,
                    schema: bt.schema,
                    func: async (params) => {
                        const cost = calculateCreditCost({ action: "browser_action" });
                        // Fire-and-forget credit deduction — don't block browser action
                        deductCredits({
                            workspaceId,
                            amount: cost,
                            type: "browser_action",
                            metadata: { agentId, action: bt.name },
                        }).catch((err) =>
                            logger.warn({ err }, "Browser action credit deduction failed")
                        );
                        return bt.func(params);
                    },
                });
                langchainTools.push(wrappedTool);
            }
            hasBrowser = true;
        }
    } catch (error) {
        logger.warn(
            { error, agentId },
            "Failed to load browser tools, proceeding without them"
        );
    }

    // --- 5. Fetch KB metadata for prompt builder ---
    const kbCapabilities: KBCapability[] = [];
    if (allowedKbIds.length > 0) {
        try {
            const kbs = await kbRepository.findKBsByIds(allowedKbIds, workspaceId);
            for (const kb of kbs) {
                const docs = await kbRepository.findDocumentsByKB(kb.id, workspaceId);
                kbCapabilities.push({
                    name: kb.name,
                    description: kb.description,
                    documentCount: docs.length,
                });
            }
        } catch (error) {
            logger.warn({ error }, "Failed to fetch KB metadata for prompt builder");
        }
    }

    // --- 6. Fetch skill metadata for prompt builder ---
    const permittedSkills = await skillRepository.findByIds(
        allowedSkillIds,
        workspaceId
    );
    const skillCapabilities: SkillCapability[] = permittedSkills.map((s) => ({
        name: s.name,
        description: s.description,
    }));

    // --- 7. System tools ---
    const systemPermissions: SystemPermissions = {
        canManageKB: agent.canManageKB,
        canManageSkills: agent.canManageSkills,
        canManageTools: agent.canManageTools,
        canManageSchedules: agent.canManageSchedules,
        canManageTasks: agent.canManageTasks,
        canManageChannels: agent.canManageChannels,
        canManageAgents: agent.canManageAgents,
    };

    if (agent.systemLevelAccess) {
        const systemTools = buildSystemTools({
            agentId,
            workspaceId,
            permissions: systemPermissions,
        });
        langchainTools.push(...systemTools);
    }

    // --- Build capability-aware system prompt ---
    const capabilities: AgentCapabilities = {
        kbs: kbCapabilities,
        skills: skillCapabilities,
        tools: toolCapabilities,
        mcpServers: mcpServerCapabilities,
        hasBrowser,
        browserProfileName: browserProfile?.name,
        connectedAgents,
        composioIntegrations,
        systemLevelAccess: agent.systemLevelAccess,
        systemPermissions,
    };

    const baseSystemPrompt = buildSystemPrompt(
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
            delegateAgents: delegateAgentIds.length,
            composioTools: composioToolCount,
            kbCount: allowedKbIds.length,
            skillCount: permittedSkills.length,
            systemAccess: agent.systemLevelAccess,
        },
        "Agent graph created"
    );

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

    const agentNode = async (state: typeof MessagesAnnotation.State) => {
        // --- Credit check BEFORE LLM call ---
        const estimatedCost = calculateCreditCost({
            action: "chat_message",
            modelMultiplier,
        });
        const creditCheck = await checkCredits(workspaceId, estimatedCost);
        if (!creditCheck.allowed) {
            const errorMsg = `Insufficient credits. Available: ${creditCheck.available}. Required: ~${estimatedCost}. Top up at Settings > Billing.`;
            return { messages: [new AIMessage(errorMsg)] };
        }

        // Build dynamic system prompt
        const systemPromptParts: string[] = [];

        // 1. KB context (RAG) — with credit deduction
        if (allowedKbIds.length > 0) {
            const lastUserMsg = [...state.messages]
                .reverse()
                .find((m) => m instanceof HumanMessage);
            if (lastUserMsg && typeof lastUserMsg.content === "string") {
                try {
                    const results = await kbService.queryKB(
                        allowedKbIds,
                        lastUserMsg.content,
                        workspaceId,
                        5
                    );
                    if (results.length > 0) {
                        const context = results
                            .map((r) => r.content)
                            .join("\n\n---\n\n");
                        systemPromptParts.push(
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
                } catch (error) {
                    logger.warn(
                        { error, agentId },
                        "KB query failed, proceeding without context"
                    );
                }
            }
        }

        // 2. Capability-aware system prompt
        systemPromptParts.push(baseSystemPrompt);

        // 3. Skills instructions
        if (skillsSection) {
            systemPromptParts.push(skillsSection);
        }

        // 4. Artifact generation instructions
        systemPromptParts.push(`## File & Document Generation

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

        const systemMsg = new SystemMessage(systemPromptParts.join("\n\n"));
        let response;
        try {
            response = await llmWithTools.invoke([systemMsg, ...state.messages]);
        } catch (error: unknown) {
            const status = (error as { status?: number })?.status;
            const errType = (error as { error?: { type?: string } })?.error?.type;
            if (
                isClaudeDirect &&
                (status === 401 || errType === "authentication_error")
            ) {
                logger.warn("Claude token expired during LLM call, refreshing and retrying…");
                await refreshClaudeToken();
                const freshLlm = recreateLLM();
                const freshLlmWithTools =
                    langchainTools.length > 0
                        ? freshLlm.bindTools(langchainTools)
                        : freshLlm;
                response = await freshLlmWithTools.invoke([systemMsg, ...state.messages]);
            } else {
                throw error;
            }
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

        return { messages: [response] };
    };

    // Route function
    const shouldContinue = (state: typeof MessagesAnnotation.State) => {
        const lastMessage = state.messages[state.messages.length - 1];
        if (
            lastMessage &&
            "tool_calls" in lastMessage &&
            (lastMessage as AIMessage).tool_calls &&
            (lastMessage as AIMessage).tool_calls!.length > 0
        ) {
            return "tools";
        }
        return "__end__";
    };

    const graph = new StateGraph(MessagesAnnotation)
        .addNode("agent", agentNode);

    if (langchainTools.length > 0) {
        const toolNode = new ToolNode(langchainTools);
        graph
            .addNode("tools", toolNode)
            .addEdge("__start__", "agent")
            .addConditionalEdges("agent", shouldContinue)
            .addEdge("tools", "agent");
    } else {
        graph
            .addEdge("__start__", "agent")
            .addEdge("agent", "__end__");
    }

    const checkpointer = await getCheckpointer();

    return graph.compile({ checkpointer });
}
