import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { kbService } from "../services/kb.service.ts";
import { skillService } from "../services/skill.service.ts";
import { toolService } from "../services/tool.service.ts";
import { scheduleService } from "../services/schedule.service.ts";
import { channelService } from "../services/channel.service.ts";
import { agentService } from "../services/agent.service.ts";
import { permissionService } from "../services/permission.service.ts";
import { integrationService } from "../services/integration.service.ts";
import { logger } from "../lib/logger.ts";
import type { SystemPermissions } from "../lib/system-prompt-builder.ts";

interface SystemToolsConfig {
    agentId: string;
    workspaceId: string;
    permissions: SystemPermissions;
}

export function buildSystemTools(config: SystemToolsConfig): DynamicStructuredTool[] {
    const { agentId, workspaceId, permissions } = config;
    const tools: DynamicStructuredTool[] = [];

    // --- KB Management ---
    if (permissions.canManageKB) {
        tools.push(
            new DynamicStructuredTool({
                name: "system_create_kb",
                description:
                    "Create a new knowledge base in the workspace.",
                schema: z.object({
                    name: z.string().describe("Name of the knowledge base"),
                    description: z
                        .string()
                        .optional()
                        .describe("Description of what this KB contains"),
                }),
                func: async ({ name, description }) => {
                    try {
                        const kb = await kbService.createKB(
                            { name, description },
                            workspaceId
                        );
                        return `Created knowledge base "${kb.name}" (ID: ${kb.id})`;
                    } catch (error) {
                        logger.error({ error }, "system_create_kb failed");
                        return `Failed to create KB: ${error instanceof Error ? error.message : "Unknown error"}`;
                    }
                },
            }),
            new DynamicStructuredTool({
                name: "system_delete_kb",
                description:
                    "Delete a knowledge base. IRREVERSIBLE. You must provide the exact KB name as confirmation.",
                schema: z.object({
                    kbId: z.string().describe("ID of the KB to delete"),
                    confirmName: z
                        .string()
                        .describe(
                            "Exact name of the KB — must match for safety"
                        ),
                }),
                func: async ({ kbId, confirmName }) => {
                    try {
                        const kb = await kbService.getKB(kbId, workspaceId);
                        if (kb.name !== confirmName) {
                            return `Safety check failed: provided name "${confirmName}" does not match KB name "${kb.name}". Deletion aborted.`;
                        }
                        await kbService.deleteKB(kbId, workspaceId);
                        return `Deleted knowledge base "${kb.name}" (ID: ${kbId}) and all its documents.`;
                    } catch (error) {
                        logger.error({ error }, "system_delete_kb failed");
                        return `Failed to delete KB: ${error instanceof Error ? error.message : "Unknown error"}`;
                    }
                },
            }),
            new DynamicStructuredTool({
                name: "system_add_document",
                description:
                    "Add a text document to a knowledge base. The content will be chunked and embedded.",
                schema: z.object({
                    kbId: z.string().describe("ID of the target KB"),
                    title: z.string().describe("Document title/filename"),
                    content: z
                        .string()
                        .describe("Full text content of the document"),
                }),
                func: async ({ kbId, title, content }) => {
                    try {
                        const buffer = Buffer.from(content, "utf-8");
                        const doc = await kbService.uploadDocument(
                            {
                                filename: title.endsWith(".txt")
                                    ? title
                                    : `${title}.txt`,
                                buffer,
                                mimetype: "text/plain",
                            },
                            kbId,
                            workspaceId
                        );
                        return `Added document "${doc.filename}" to KB (${doc.chunkCount} chunks created, ID: ${doc.id})`;
                    } catch (error) {
                        logger.error({ error }, "system_add_document failed");
                        return `Failed to add document: ${error instanceof Error ? error.message : "Unknown error"}`;
                    }
                },
            }),
            new DynamicStructuredTool({
                name: "system_delete_document",
                description: "Remove a document and its chunks from a KB.",
                schema: z.object({
                    documentId: z
                        .string()
                        .describe("ID of the document to delete"),
                    kbId: z.string().describe("ID of the KB containing the document"),
                }),
                func: async ({ documentId, kbId }) => {
                    try {
                        await kbService.deleteDocument(
                            documentId,
                            kbId,
                            workspaceId
                        );
                        return `Deleted document (ID: ${documentId}) and all its chunks.`;
                    } catch (error) {
                        logger.error(
                            { error },
                            "system_delete_document failed"
                        );
                        return `Failed to delete document: ${error instanceof Error ? error.message : "Unknown error"}`;
                    }
                },
            })
        );
    }

    // --- Skills Management ---
    if (permissions.canManageSkills) {
        tools.push(
            new DynamicStructuredTool({
                name: "system_create_skill",
                description: "Create a new skill in the workspace.",
                schema: z.object({
                    name: z.string().describe("Skill name"),
                    description: z
                        .string()
                        .optional()
                        .describe("What the skill does"),
                    prompt: z
                        .string()
                        .describe("The skill's instruction prompt"),
                }),
                func: async ({ name, description, prompt }) => {
                    try {
                        const skill = await skillService.createSkill(
                            {
                                name,
                                description,
                                instructions: prompt,
                            },
                            workspaceId
                        );
                        return `Created skill "${skill.name}" (ID: ${skill.id})`;
                    } catch (error) {
                        logger.error({ error }, "system_create_skill failed");
                        return `Failed to create skill: ${error instanceof Error ? error.message : "Unknown error"}`;
                    }
                },
            }),
            new DynamicStructuredTool({
                name: "system_update_skill",
                description: "Update an existing skill.",
                schema: z.object({
                    skillId: z.string().describe("ID of the skill to update"),
                    name: z.string().optional().describe("New name"),
                    description: z
                        .string()
                        .optional()
                        .describe("New description"),
                    prompt: z
                        .string()
                        .optional()
                        .describe("New instruction prompt"),
                }),
                func: async ({ skillId, name, description, prompt }) => {
                    try {
                        const data: Record<string, string> = {};
                        if (name) data.name = name;
                        if (description) data.description = description;
                        if (prompt) data.instructions = prompt;
                        const skill = await skillService.updateSkill(
                            skillId,
                            workspaceId,
                            data
                        );
                        return `Updated skill "${skill.name}" (ID: ${skillId})`;
                    } catch (error) {
                        logger.error({ error }, "system_update_skill failed");
                        return `Failed to update skill: ${error instanceof Error ? error.message : "Unknown error"}`;
                    }
                },
            }),
            new DynamicStructuredTool({
                name: "system_delete_skill",
                description: "Delete a skill from the workspace.",
                schema: z.object({
                    skillId: z.string().describe("ID of the skill to delete"),
                }),
                func: async ({ skillId }) => {
                    try {
                        await skillService.deleteSkill(skillId, workspaceId);
                        return `Deleted skill (ID: ${skillId})`;
                    } catch (error) {
                        logger.error({ error }, "system_delete_skill failed");
                        return `Failed to delete skill: ${error instanceof Error ? error.message : "Unknown error"}`;
                    }
                },
            })
        );
    }

    // --- Tools Management ---
    if (permissions.canManageTools) {
        tools.push(
            new DynamicStructuredTool({
                name: "system_create_tool",
                description:
                    "Register a new webhook/function tool in the workspace.",
                schema: z.object({
                    name: z.string().describe("Tool name"),
                    description: z
                        .string()
                        .optional()
                        .describe("What the tool does"),
                    url: z
                        .string()
                        .describe("Webhook URL (supports {{var}} placeholders)"),
                    method: z
                        .enum(["GET", "POST"])
                        .default("POST")
                        .describe("HTTP method"),
                }),
                func: async ({ name, description, url, method }) => {
                    try {
                        const tool = await toolService.createTool(
                            {
                                name,
                                description,
                                type: "function",
                                config: { webhookUrl: url, method },
                            },
                            workspaceId
                        );
                        return `Created tool "${tool.name}" (ID: ${tool.id})`;
                    } catch (error) {
                        logger.error({ error }, "system_create_tool failed");
                        return `Failed to create tool: ${error instanceof Error ? error.message : "Unknown error"}`;
                    }
                },
            }),
            new DynamicStructuredTool({
                name: "system_delete_tool",
                description: "Remove a tool from the workspace.",
                schema: z.object({
                    toolId: z.string().describe("ID of the tool to delete"),
                }),
                func: async ({ toolId }) => {
                    try {
                        await toolService.deleteTool(toolId);
                        return `Deleted tool (ID: ${toolId})`;
                    } catch (error) {
                        logger.error({ error }, "system_delete_tool failed");
                        return `Failed to delete tool: ${error instanceof Error ? error.message : "Unknown error"}`;
                    }
                },
            })
        );
    }

    // --- Schedule Management ---
    if (permissions.canManageSchedules) {
        tools.push(
            new DynamicStructuredTool({
                name: "system_create_schedule",
                description:
                    "Set up a new recurring schedule. The agent will receive the prompt on the specified schedule.",
                schema: z.object({
                    targetAgentId: z
                        .string()
                        .optional()
                        .describe("ID of the agent to run the prompt on. Defaults to yourself."),
                    name: z.string().describe("Schedule name"),
                    prompt: z
                        .string()
                        .describe("The prompt the agent will receive each time the schedule fires"),
                    scheduleDescription: z
                        .string()
                        .describe(
                            "Natural language schedule description (e.g. 'every weekday at 9am')"
                        ),
                    timezone: z
                        .string()
                        .default("UTC")
                        .describe("Timezone (e.g. 'Asia/Kolkata')"),
                }),
                func: async ({ targetAgentId, name, prompt, scheduleDescription, timezone }) => {
                    try {
                        const schedule = await scheduleService.createSchedule(
                            {
                                name,
                                agentId: targetAgentId || agentId,
                                prompt,
                                scheduleType: "natural",
                                naturalLanguage: scheduleDescription,
                                timezone,
                            },
                            workspaceId
                        );
                        return `Created schedule "${schedule.name}" (ID: ${schedule.id}) — next run: ${schedule.nextRunDescription || "pending"}`;
                    } catch (error) {
                        logger.error(
                            { error },
                            "system_create_schedule failed"
                        );
                        return `Failed to create schedule: ${error instanceof Error ? error.message : "Unknown error"}`;
                    }
                },
            }),
            new DynamicStructuredTool({
                name: "system_update_schedule",
                description: "Update a schedule's prompt, name, or timing.",
                schema: z.object({
                    scheduleId: z.string().describe("ID of the schedule to update"),
                    name: z.string().optional().describe("New name"),
                    prompt: z.string().optional().describe("New prompt"),
                    cron: z.string().optional().describe("New cron expression"),
                    enabled: z.boolean().optional().describe("Enable or disable"),
                }),
                func: async ({ scheduleId, name, prompt, cron, enabled }) => {
                    try {
                        const data: Record<string, unknown> = {};
                        if (name) data.name = name;
                        if (prompt) data.prompt = prompt;
                        if (cron) data.cron = cron;
                        if (enabled !== undefined) data.enabled = enabled;
                        await scheduleService.updateSchedule(
                            scheduleId,
                            workspaceId,
                            data as Parameters<typeof scheduleService.updateSchedule>[2]
                        );
                        return `Updated schedule (ID: ${scheduleId})`;
                    } catch (error) {
                        logger.error(
                            { error },
                            "system_update_schedule failed"
                        );
                        return `Failed to update schedule: ${error instanceof Error ? error.message : "Unknown error"}`;
                    }
                },
            }),
            new DynamicStructuredTool({
                name: "system_pause_schedule",
                description: "Temporarily disable a schedule.",
                schema: z.object({
                    scheduleId: z
                        .string()
                        .describe("ID of the schedule to pause"),
                }),
                func: async ({ scheduleId }) => {
                    try {
                        await scheduleService.updateSchedule(
                            scheduleId,
                            workspaceId,
                            { enabled: false }
                        );
                        return `Paused schedule (ID: ${scheduleId})`;
                    } catch (error) {
                        logger.error(
                            { error },
                            "system_pause_schedule failed"
                        );
                        return `Failed to pause schedule: ${error instanceof Error ? error.message : "Unknown error"}`;
                    }
                },
            }),
            new DynamicStructuredTool({
                name: "system_delete_schedule",
                description: "Permanently remove a schedule.",
                schema: z.object({
                    scheduleId: z
                        .string()
                        .describe("ID of the schedule to delete"),
                }),
                func: async ({ scheduleId }) => {
                    try {
                        await scheduleService.deleteSchedule(
                            scheduleId,
                            workspaceId
                        );
                        return `Deleted schedule (ID: ${scheduleId})`;
                    } catch (error) {
                        logger.error(
                            { error },
                            "system_delete_schedule failed"
                        );
                        return `Failed to delete schedule: ${error instanceof Error ? error.message : "Unknown error"}`;
                    }
                },
            })
        );
    }

    // --- Channel Management ---
    if (permissions.canManageChannels) {
        tools.push(
            new DynamicStructuredTool({
                name: "system_list_channels",
                description: "List all connected messaging channels.",
                schema: z.object({}),
                func: async () => {
                    try {
                        const channels =
                            await channelService.getConnections(workspaceId);
                        if (channels.length === 0) {
                            return "No channels connected.";
                        }
                        const lines = channels.map(
                            (ch) =>
                                `- ${ch.name} (${ch.channelType}, status: ${ch.status}, ID: ${ch.id})`
                        );
                        return `Connected channels:\n${lines.join("\n")}`;
                    } catch (error) {
                        logger.error(
                            { error },
                            "system_list_channels failed"
                        );
                        return `Failed to list channels: ${error instanceof Error ? error.message : "Unknown error"}`;
                    }
                },
            }),
            new DynamicStructuredTool({
                name: "system_delete_channel",
                description: "Disconnect a messaging channel.",
                schema: z.object({
                    channelId: z
                        .string()
                        .describe("ID of the channel to disconnect"),
                }),
                func: async ({ channelId }) => {
                    try {
                        await channelService.deleteConnection(
                            channelId,
                            workspaceId
                        );
                        return `Disconnected channel (ID: ${channelId})`;
                    } catch (error) {
                        logger.error(
                            { error },
                            "system_delete_channel failed"
                        );
                        return `Failed to disconnect channel: ${error instanceof Error ? error.message : "Unknown error"}`;
                    }
                },
            })
        );
    }

    // --- Agent Management ---
    if (permissions.canManageAgents) {
        tools.push(
            new DynamicStructuredTool({
                name: "system_list_agents",
                description: "List all agents in the workspace.",
                schema: z.object({}),
                func: async () => {
                    try {
                        const agents =
                            await agentService.getAgents(workspaceId);
                        if (agents.length === 0) {
                            return "No agents in this workspace.";
                        }
                        const lines = agents.map(
                            (a) =>
                                `- ${a.name} (model: ${a.model}, ID: ${a.id})`
                        );
                        return `Agents:\n${lines.join("\n")}`;
                    } catch (error) {
                        logger.error({ error }, "system_list_agents failed");
                        return `Failed to list agents: ${error instanceof Error ? error.message : "Unknown error"}`;
                    }
                },
            }),
            new DynamicStructuredTool({
                name: "system_create_agent",
                description: "Create a new agent in the workspace.",
                schema: z.object({
                    name: z.string().describe("Agent name"),
                    role: z
                        .string()
                        .describe("Agent role (used in system prompt)"),
                    description: z
                        .string()
                        .describe("Agent description/purpose"),
                }),
                func: async ({ name, role, description }) => {
                    try {
                        const agent = await agentService.createAgent(
                            {
                                name,
                                systemPrompt: `Role: ${role}\n\n${description}`,
                            },
                            workspaceId
                        );
                        return `Created agent "${agent.name}" (ID: ${agent.id})`;
                    } catch (error) {
                        logger.error({ error }, "system_create_agent failed");
                        return `Failed to create agent: ${error instanceof Error ? error.message : "Unknown error"}`;
                    }
                },
            }),
            new DynamicStructuredTool({
                name: "system_update_agent",
                description: "Update an existing agent's configuration.",
                schema: z.object({
                    agentId: z.string().describe("ID of the agent to update"),
                    name: z.string().optional().describe("New name"),
                    role: z.string().optional().describe("New role"),
                    description: z
                        .string()
                        .optional()
                        .describe("New description"),
                }),
                func: async ({ agentId: targetAgentId, name, role, description }) => {
                    try {
                        const data: Record<string, string> = {};
                        if (name) data.name = name;
                        if (role || description) {
                            data.systemPrompt = `Role: ${role || ""}\n\n${description || ""}`;
                        }
                        const agent = await agentService.updateAgent(
                            targetAgentId,
                            workspaceId,
                            data
                        );
                        return `Updated agent "${agent.name}" (ID: ${targetAgentId})`;
                    } catch (error) {
                        logger.error({ error }, "system_update_agent failed");
                        return `Failed to update agent: ${error instanceof Error ? error.message : "Unknown error"}`;
                    }
                },
            }),

            // --- Resource Assignment Tools ---
            new DynamicStructuredTool({
                name: "system_assign_resource_to_agent",
                description:
                    "Grant an agent access to a resource (KB, tool, skill, or another agent for delegation). " +
                    "This sets a permission so the agent can use that resource at runtime.",
                schema: z.object({
                    agentId: z.string().describe("ID of the agent to grant access to"),
                    resourceType: z.enum(["kb", "tool", "skill", "agent"]).describe("Type of resource"),
                    resourceId: z.string().describe("ID of the resource to grant access to"),
                }),
                func: async ({ agentId: targetAgentId, resourceType, resourceId }) => {
                    try {
                        await permissionService.setPermissions(targetAgentId, workspaceId, [
                            { resourceType, resourceId, allowed: true },
                        ]);
                        return `Granted ${resourceType} access (${resourceId}) to agent ${targetAgentId}.`;
                    } catch (error) {
                        logger.error({ error }, "system_assign_resource_to_agent failed");
                        return `Failed to assign resource: ${error instanceof Error ? error.message : "Unknown error"}`;
                    }
                },
            }),

            new DynamicStructuredTool({
                name: "system_remove_resource_from_agent",
                description:
                    "Revoke an agent's access to a resource (KB, tool, skill, or another agent).",
                schema: z.object({
                    agentId: z.string().describe("ID of the agent to revoke access from"),
                    resourceType: z.enum(["kb", "tool", "skill", "agent"]).describe("Type of resource"),
                    resourceId: z.string().describe("ID of the resource to revoke"),
                }),
                func: async ({ agentId: targetAgentId, resourceType, resourceId }) => {
                    try {
                        await permissionService.setPermissions(targetAgentId, workspaceId, [
                            { resourceType, resourceId, allowed: false },
                        ]);
                        return `Revoked ${resourceType} access (${resourceId}) from agent ${targetAgentId}.`;
                    } catch (error) {
                        logger.error({ error }, "system_remove_resource_from_agent failed");
                        return `Failed to remove resource: ${error instanceof Error ? error.message : "Unknown error"}`;
                    }
                },
            }),

            new DynamicStructuredTool({
                name: "system_get_agent_permissions",
                description:
                    "List all resource permissions for an agent — shows which KBs, tools, skills, and agents it has access to.",
                schema: z.object({
                    agentId: z.string().describe("ID of the agent"),
                }),
                func: async ({ agentId: targetAgentId }) => {
                    try {
                        const perms = await permissionService.getAgentPermissions(targetAgentId, workspaceId);
                        if (perms.length === 0) return "This agent has no resource permissions.";
                        const lines = perms.map(
                            (p) => `- [${p.resourceType}] ${p.resourceId} — ${p.allowed ? "allowed" : "denied"}`
                        );
                        return `Permissions (${perms.length}):\n${lines.join("\n")}`;
                    } catch (error) {
                        logger.error({ error }, "system_get_agent_permissions failed");
                        return `Failed to get permissions: ${error instanceof Error ? error.message : "Unknown error"}`;
                    }
                },
            }),

            new DynamicStructuredTool({
                name: "system_set_agent_system_permissions",
                description:
                    "Set system-level permissions for an agent (manage KBs, tools, skills, schedules, channels, agents, bucket, python). " +
                    "systemLevelAccess must be true for management permissions to take effect.",
                schema: z.object({
                    agentId: z.string().describe("ID of the agent"),
                    systemLevelAccess: z.boolean().describe("Enable system-level access"),
                    canManageKB: z.boolean().default(false).describe("Can create/delete knowledge bases"),
                    canManageSkills: z.boolean().default(false).describe("Can create/delete skills"),
                    canManageTools: z.boolean().default(false).describe("Can create/delete tools"),
                    canManageSchedules: z.boolean().default(false).describe("Can create/delete schedules"),
                    canManageChannels: z.boolean().default(false).describe("Can manage channels"),
                    canManageAgents: z.boolean().default(false).describe("Can create/update agents"),
                    canManageBucket: z.boolean().default(true).describe("Can manage file storage"),
                    canExecutePython: z.boolean().default(true).describe("Can execute Python code"),
                }),
                func: async ({ agentId: targetAgentId, ...perms }) => {
                    try {
                        await agentService.updateSystemPermissions(targetAgentId, workspaceId, perms);
                        return `Updated system permissions for agent ${targetAgentId}. systemLevelAccess: ${perms.systemLevelAccess}`;
                    } catch (error) {
                        logger.error({ error }, "system_set_agent_system_permissions failed");
                        return `Failed to set permissions: ${error instanceof Error ? error.message : "Unknown error"}`;
                    }
                },
            }),

            new DynamicStructuredTool({
                name: "system_assign_integration_to_agent",
                description:
                    "Assign a Composio integration (Gmail, Slack, LinkedIn, etc.) to an agent so it can use that integration's tools.",
                schema: z.object({
                    agentId: z.string().describe("ID of the agent"),
                    integrationId: z.string().describe("ID of the integration to assign"),
                }),
                func: async ({ agentId: targetAgentId, integrationId }) => {
                    try {
                        await integrationService.assignToAgent(targetAgentId, integrationId, workspaceId);
                        return `Assigned integration ${integrationId} to agent ${targetAgentId}.`;
                    } catch (error) {
                        logger.error({ error }, "system_assign_integration_to_agent failed");
                        return `Failed to assign integration: ${error instanceof Error ? error.message : "Unknown error"}`;
                    }
                },
            }),

            new DynamicStructuredTool({
                name: "system_remove_integration_from_agent",
                description: "Remove a Composio integration from an agent.",
                schema: z.object({
                    agentId: z.string().describe("ID of the agent"),
                    integrationId: z.string().describe("ID of the integration to remove"),
                }),
                func: async ({ agentId: targetAgentId, integrationId }) => {
                    try {
                        await integrationService.removeFromAgent(targetAgentId, integrationId, workspaceId);
                        return `Removed integration ${integrationId} from agent ${targetAgentId}.`;
                    } catch (error) {
                        logger.error({ error }, "system_remove_integration_from_agent failed");
                        return `Failed to remove integration: ${error instanceof Error ? error.message : "Unknown error"}`;
                    }
                },
            }),

            new DynamicStructuredTool({
                name: "system_list_integrations",
                description: "List all Composio integrations in the workspace (Gmail, Slack, LinkedIn, etc.).",
                schema: z.object({}),
                func: async () => {
                    try {
                        const integrations = await integrationService.getIntegrations(workspaceId);
                        if (integrations.length === 0) return "No integrations in this workspace.";
                        const lines = integrations.map(
                            (i) => `- ${i.connectionLabel || i.name} (${i.composioToolkitSlug}) — ${i.status} — ID: ${i.id}`
                        );
                        return `Integrations (${integrations.length}):\n${lines.join("\n")}`;
                    } catch (error) {
                        logger.error({ error }, "system_list_integrations failed");
                        return `Failed to list integrations: ${error instanceof Error ? error.message : "Unknown error"}`;
                    }
                },
            }),

            new DynamicStructuredTool({
                name: "system_list_tools",
                description: "List all tools (MCP and function) available in the workspace.",
                schema: z.object({}),
                func: async () => {
                    try {
                        const allTools = await toolService.getTools(workspaceId);
                        if (allTools.length === 0) return "No tools in this workspace.";
                        const lines = allTools.map(
                            (t) => `- ${t.name} (${t.type}) — ID: ${t.id}${t.description ? ` — ${t.description}` : ""}`
                        );
                        return `Tools (${allTools.length}):\n${lines.join("\n")}`;
                    } catch (error) {
                        logger.error({ error }, "system_list_tools failed");
                        return `Failed to list tools: ${error instanceof Error ? error.message : "Unknown error"}`;
                    }
                },
            }),

            new DynamicStructuredTool({
                name: "system_list_kbs",
                description: "List all knowledge bases in the workspace.",
                schema: z.object({}),
                func: async () => {
                    try {
                        const kbs = await kbService.getKBs(workspaceId);
                        if (kbs.length === 0) return "No knowledge bases in this workspace.";
                        const lines = kbs.map(
                            (k) => `- ${k.name} — ID: ${k.id}${k.description ? ` — ${k.description}` : ""}`
                        );
                        return `Knowledge Bases (${kbs.length}):\n${lines.join("\n")}`;
                    } catch (error) {
                        logger.error({ error }, "system_list_kbs failed");
                        return `Failed to list KBs: ${error instanceof Error ? error.message : "Unknown error"}`;
                    }
                },
            }),

            new DynamicStructuredTool({
                name: "system_list_skills",
                description: "List all skills in the workspace.",
                schema: z.object({}),
                func: async () => {
                    try {
                        const allSkills = await skillService.getSkills(workspaceId);
                        if (allSkills.length === 0) return "No skills in this workspace.";
                        const lines = allSkills.map(
                            (s) => `- ${s.name} — ID: ${s.id}${s.description ? ` — ${s.description}` : ""}`
                        );
                        return `Skills (${allSkills.length}):\n${lines.join("\n")}`;
                    } catch (error) {
                        logger.error({ error }, "system_list_skills failed");
                        return `Failed to list skills: ${error instanceof Error ? error.message : "Unknown error"}`;
                    }
                },
            })
        );
    }

    return tools;
}
