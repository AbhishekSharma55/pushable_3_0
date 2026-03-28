import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { projectService } from "../services/project.service.ts";
import { runReportRepository } from "../repositories/runReport.repository.ts";
import { projectRepository } from "../repositories/project.repository.ts";
import { logger } from "../lib/logger.ts";

interface CEOToolsConfig {
    agentId: string;
    workspaceId: string;
}

export function buildCEOTools(config: CEOToolsConfig): DynamicStructuredTool[] {
    const { agentId, workspaceId } = config;
    const tools: DynamicStructuredTool[] = [];

    // ── Project Management ─────────────────────────────────────────────────

    tools.push(
        new DynamicStructuredTool({
            name: "ceo_create_project",
            description:
                "Create a new project in the workspace. Projects organize agents, knowledge bases, milestones, and shared context around a specific goal.",
            schema: z.object({
                name: z.string().describe("Project name (e.g. 'Dental Doctors - LA Lead Gen')"),
                description: z.string().optional().describe("Brief description of the project goal"),
                instructions: z.string().optional().describe("Shared context/instructions for all agents in this project"),
            }),
            func: async ({ name, description, instructions }) => {
                try {
                    const project = await projectService.create({
                        workspaceId,
                        name,
                        description,
                        instructions,
                        createdBy: agentId,
                    });
                    return `Created project "${project.name}" (ID: ${project.id})`;
                } catch (error) {
                    logger.error({ error }, "ceo_create_project failed");
                    return `Failed to create project: ${error instanceof Error ? error.message : "Unknown error"}`;
                }
            },
        })
    );

    tools.push(
        new DynamicStructuredTool({
            name: "ceo_update_project",
            description: "Update a project's name, description, instructions, or status.",
            schema: z.object({
                projectId: z.string().describe("ID of the project to update"),
                name: z.string().optional().describe("New project name"),
                description: z.string().optional().describe("New project description"),
                instructions: z.string().optional().describe("New shared instructions for agents"),
                status: z.enum(["active", "paused", "completed", "archived"]).optional().describe("New project status"),
            }),
            func: async ({ projectId, name, description, instructions, status }) => {
                try {
                    const updates: Record<string, string> = {};
                    if (name) updates.name = name;
                    if (description) updates.description = description;
                    if (instructions) updates.instructions = instructions;
                    if (status) updates.status = status;
                    const project = await projectService.update(projectId, workspaceId, updates);
                    return `Updated project "${project.name}" (ID: ${project.id})`;
                } catch (error) {
                    logger.error({ error }, "ceo_update_project failed");
                    return `Failed to update project: ${error instanceof Error ? error.message : "Unknown error"}`;
                }
            },
        })
    );

    tools.push(
        new DynamicStructuredTool({
            name: "ceo_delete_project",
            description:
                "Delete a project. IRREVERSIBLE. You must provide the exact project name as confirmation.",
            schema: z.object({
                projectId: z.string().describe("ID of the project to delete"),
                confirmName: z.string().describe("Exact name of the project — must match for safety"),
            }),
            func: async ({ projectId, confirmName }) => {
                try {
                    const project = await projectService.getById(projectId, workspaceId);
                    if (project.name !== confirmName) {
                        return `Safety check failed: provided name "${confirmName}" does not match project name "${project.name}". Deletion aborted.`;
                    }
                    await projectService.delete(projectId, workspaceId);
                    return `Deleted project "${project.name}" and all its milestones/assignments.`;
                } catch (error) {
                    logger.error({ error }, "ceo_delete_project failed");
                    return `Failed to delete project: ${error instanceof Error ? error.message : "Unknown error"}`;
                }
            },
        })
    );

    tools.push(
        new DynamicStructuredTool({
            name: "ceo_list_projects",
            description: "List all projects in the workspace with their status, agent count, and milestone progress.",
            schema: z.object({}),
            func: async () => {
                try {
                    const projectsList = await projectService.list(workspaceId);
                    if (projectsList.length === 0) return "No projects found in this workspace.";

                    const summaries = await Promise.all(
                        projectsList.map(async (p) => {
                            const [agentsList, milestones] = await Promise.all([
                                projectRepository.getAgents(p.id, workspaceId),
                                projectRepository.getMilestones(p.id, workspaceId),
                            ]);
                            const completedMilestones = milestones.filter((m) => m.status === "completed").length;
                            return `- **${p.name}** (ID: ${p.id}) — Status: ${p.status}, Agents: ${agentsList.length}, Milestones: ${completedMilestones}/${milestones.length} completed`;
                        })
                    );
                    return `Projects (${projectsList.length}):\n${summaries.join("\n")}`;
                } catch (error) {
                    logger.error({ error }, "ceo_list_projects failed");
                    return `Failed to list projects: ${error instanceof Error ? error.message : "Unknown error"}`;
                }
            },
        })
    );

    tools.push(
        new DynamicStructuredTool({
            name: "ceo_get_project_details",
            description:
                "Get full details of a project including milestones, assigned agents, linked knowledge bases, and recent run reports.",
            schema: z.object({
                projectId: z.string().describe("ID of the project"),
            }),
            func: async ({ projectId }) => {
                try {
                    const project = await projectService.getByIdWithDetails(projectId, workspaceId);

                    const parts = [
                        `## Project: ${project.name}`,
                        `Status: ${project.status}`,
                        project.description ? `Description: ${project.description}` : "",
                        project.instructions ? `Instructions: ${project.instructions}` : "",
                        "",
                        `### Milestones (${project.milestones.length})`,
                    ];

                    if (project.milestones.length > 0) {
                        for (const m of project.milestones) {
                            parts.push(`- [${m.status}] ${m.title}${m.targetDate ? ` (target: ${m.targetDate.toISOString().split("T")[0]})` : ""}${m.evaluationNotes ? ` — ${m.evaluationNotes}` : ""}`);
                        }
                    } else {
                        parts.push("  No milestones defined.");
                    }

                    parts.push("", `### Agents (${project.agents.length})`);
                    if (project.agents.length > 0) {
                        for (const a of project.agents) {
                            parts.push(`- ${a.agent.name} (ID: ${a.agentId})${a.roleInProject ? ` — Role: ${a.roleInProject}` : ""}`);
                        }
                    } else {
                        parts.push("  No agents assigned.");
                    }

                    parts.push("", `### Knowledge Bases (${project.knowledgeBases.length})`);
                    if (project.knowledgeBases.length > 0) {
                        for (const kb of project.knowledgeBases) {
                            parts.push(`- ${kb.knowledgeBase.name} (ID: ${kb.kbId})`);
                        }
                    } else {
                        parts.push("  No KBs linked.");
                    }

                    // Recent reports
                    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
                    const reports = await runReportRepository.findByProject(projectId, workspaceId, { since, limit: 10 });
                    parts.push("", `### Recent Run Reports (last 7 days: ${reports.length})`);
                    if (reports.length > 0) {
                        for (const r of reports) {
                            parts.push(`- [${r.report.runType}] ${r.agent.name} (${r.report.createdAt.toISOString().split("T")[0]}): ${r.report.summary.substring(0, 200)}`);
                        }
                    } else {
                        parts.push("  No recent reports.");
                    }

                    return parts.filter(Boolean).join("\n");
                } catch (error) {
                    logger.error({ error }, "ceo_get_project_details failed");
                    return `Failed to get project details: ${error instanceof Error ? error.message : "Unknown error"}`;
                }
            },
        })
    );

    // ── Milestone Management ───────────────────────────────────────────────

    tools.push(
        new DynamicStructuredTool({
            name: "ceo_create_milestone",
            description: "Add a milestone to a project. Milestones are measurable checkpoints that track project progress.",
            schema: z.object({
                projectId: z.string().describe("ID of the project"),
                title: z.string().describe("Milestone title (e.g. 'Collect 100 leads')"),
                description: z.string().optional().describe("Details about what this milestone means"),
                targetDate: z.string().optional().describe("Target date in ISO format (e.g. '2025-06-15')"),
            }),
            func: async ({ projectId, title, description, targetDate }) => {
                try {
                    const milestone = await projectService.createMilestone({
                        projectId,
                        workspaceId,
                        title,
                        description,
                        targetDate: targetDate ? new Date(targetDate) : undefined,
                    });
                    return `Created milestone "${milestone.title}" (ID: ${milestone.id}) in project.`;
                } catch (error) {
                    logger.error({ error }, "ceo_create_milestone failed");
                    return `Failed to create milestone: ${error instanceof Error ? error.message : "Unknown error"}`;
                }
            },
        })
    );

    tools.push(
        new DynamicStructuredTool({
            name: "ceo_update_milestone",
            description: "Update a milestone's status, title, description, or evaluation notes.",
            schema: z.object({
                milestoneId: z.string().describe("ID of the milestone"),
                title: z.string().optional().describe("New title"),
                description: z.string().optional().describe("New description"),
                status: z.enum(["not_started", "in_progress", "completed", "blocked"]).optional().describe("New status"),
                evaluationNotes: z.string().optional().describe("Your evaluation notes on why the status changed"),
            }),
            func: async ({ milestoneId, title, description, status, evaluationNotes }) => {
                try {
                    const updates: Record<string, unknown> = {};
                    if (title) updates.title = title;
                    if (description) updates.description = description;
                    if (status) updates.status = status;
                    if (evaluationNotes) updates.evaluationNotes = evaluationNotes;
                    if (status === "completed") updates.completedAt = new Date();
                    const milestone = await projectService.updateMilestone(milestoneId, workspaceId, updates);
                    return `Updated milestone "${milestone.title}" — status: ${milestone.status}`;
                } catch (error) {
                    logger.error({ error }, "ceo_update_milestone failed");
                    return `Failed to update milestone: ${error instanceof Error ? error.message : "Unknown error"}`;
                }
            },
        })
    );

    tools.push(
        new DynamicStructuredTool({
            name: "ceo_delete_milestone",
            description: "Remove a milestone from a project.",
            schema: z.object({
                milestoneId: z.string().describe("ID of the milestone to delete"),
            }),
            func: async ({ milestoneId }) => {
                try {
                    const milestone = await projectService.deleteMilestone(milestoneId, workspaceId);
                    return `Deleted milestone "${milestone.title}".`;
                } catch (error) {
                    logger.error({ error }, "ceo_delete_milestone failed");
                    return `Failed to delete milestone: ${error instanceof Error ? error.message : "Unknown error"}`;
                }
            },
        })
    );

    tools.push(
        new DynamicStructuredTool({
            name: "ceo_evaluate_milestones",
            description:
                "Read recent run reports for a project and auto-evaluate milestone progress. Updates milestone statuses and adds evaluation notes based on agent activity.",
            schema: z.object({
                projectId: z.string().describe("ID of the project to evaluate"),
            }),
            func: async ({ projectId }) => {
                try {
                    const [milestones, reports] = await Promise.all([
                        projectService.getMilestones(projectId, workspaceId),
                        runReportRepository.findByProject(projectId, workspaceId, {
                            since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
                        }),
                    ]);

                    if (milestones.length === 0) return "No milestones to evaluate.";

                    const reportSummary = reports.length > 0
                        ? reports.map((r) => `[${r.agent.name}] ${r.report.summary}`).join("\n")
                        : "No recent reports.";

                    const milestoneList = milestones
                        .map((m) => `- [${m.status}] ${m.title}${m.description ? `: ${m.description}` : ""}`)
                        .join("\n");

                    return `## Milestone Evaluation Data\n\n### Current Milestones:\n${milestoneList}\n\n### Recent Agent Reports (last 7 days):\n${reportSummary}\n\nBased on this data, use ceo_update_milestone to update each milestone's status and evaluation notes.`;
                } catch (error) {
                    logger.error({ error }, "ceo_evaluate_milestones failed");
                    return `Failed to evaluate milestones: ${error instanceof Error ? error.message : "Unknown error"}`;
                }
            },
        })
    );

    // ── Agent-Project Assignment ───────────────────────────────────────────

    tools.push(
        new DynamicStructuredTool({
            name: "ceo_assign_agent_to_project",
            description: "Assign an agent to a project with an optional role description.",
            schema: z.object({
                agentId: z.string().describe("ID of the agent to assign"),
                projectId: z.string().describe("ID of the project"),
                roleInProject: z.string().optional().describe("What this agent does in the project (e.g. 'lead researcher', 'email outreach')"),
            }),
            func: async ({ agentId: targetAgentId, projectId, roleInProject }) => {
                try {
                    await projectService.assignAgent(projectId, targetAgentId, workspaceId, roleInProject);
                    return `Agent assigned to project${roleInProject ? ` with role: ${roleInProject}` : ""}.`;
                } catch (error) {
                    logger.error({ error }, "ceo_assign_agent_to_project failed");
                    return `Failed to assign agent: ${error instanceof Error ? error.message : "Unknown error"}`;
                }
            },
        })
    );

    tools.push(
        new DynamicStructuredTool({
            name: "ceo_remove_agent_from_project",
            description: "Remove an agent from a project.",
            schema: z.object({
                agentId: z.string().describe("ID of the agent to remove"),
                projectId: z.string().describe("ID of the project"),
            }),
            func: async ({ agentId: targetAgentId, projectId }) => {
                try {
                    await projectService.removeAgent(projectId, targetAgentId, workspaceId);
                    return "Agent removed from project.";
                } catch (error) {
                    logger.error({ error }, "ceo_remove_agent_from_project failed");
                    return `Failed to remove agent: ${error instanceof Error ? error.message : "Unknown error"}`;
                }
            },
        })
    );

    // ── KB-Project Assignment ──────────────────────────────────────────────

    tools.push(
        new DynamicStructuredTool({
            name: "ceo_assign_kb_to_project",
            description: "Link a knowledge base to a project so all project agents can reference it.",
            schema: z.object({
                kbId: z.string().describe("ID of the knowledge base"),
                projectId: z.string().describe("ID of the project"),
            }),
            func: async ({ kbId, projectId }) => {
                try {
                    await projectService.assignKB(projectId, kbId, workspaceId);
                    return "Knowledge base linked to project.";
                } catch (error) {
                    logger.error({ error }, "ceo_assign_kb_to_project failed");
                    return `Failed to link KB: ${error instanceof Error ? error.message : "Unknown error"}`;
                }
            },
        })
    );

    tools.push(
        new DynamicStructuredTool({
            name: "ceo_remove_kb_from_project",
            description: "Unlink a knowledge base from a project.",
            schema: z.object({
                kbId: z.string().describe("ID of the knowledge base"),
                projectId: z.string().describe("ID of the project"),
            }),
            func: async ({ kbId, projectId }) => {
                try {
                    await projectService.removeKB(projectId, kbId, workspaceId);
                    return "Knowledge base unlinked from project.";
                } catch (error) {
                    logger.error({ error }, "ceo_remove_kb_from_project failed");
                    return `Failed to unlink KB: ${error instanceof Error ? error.message : "Unknown error"}`;
                }
            },
        })
    );

    // ── Run Reports & Monitoring ───────────────────────────────────────────

    tools.push(
        new DynamicStructuredTool({
            name: "ceo_get_project_reports",
            description:
                "Get run reports for a project. Use this to review what agents have been doing and how the project is progressing.",
            schema: z.object({
                projectId: z.string().describe("ID of the project"),
                since: z.string().optional().describe("ISO date string — only get reports since this date (defaults to 24h ago)"),
            }),
            func: async ({ projectId, since }) => {
                try {
                    const sinceDate = since ? new Date(since) : new Date(Date.now() - 24 * 60 * 60 * 1000);
                    const reports = await runReportRepository.findByProject(projectId, workspaceId, { since: sinceDate });

                    if (reports.length === 0) return `No run reports for this project since ${sinceDate.toISOString().split("T")[0]}.`;

                    const lines = reports.map((r) => {
                        const parts = [
                            `### ${r.agent.name} — ${r.report.createdAt.toISOString().split("T")[0]} (${r.report.runType})`,
                            `**Summary:** ${r.report.summary}`,
                        ];
                        if (r.report.actionsTaken) parts.push(`**Actions:** ${r.report.actionsTaken}`);
                        if (r.report.outcomes) parts.push(`**Outcomes:** ${r.report.outcomes}`);
                        if (r.report.issues) parts.push(`**Issues:** ${r.report.issues}`);
                        if (r.report.metrics && Object.keys(r.report.metrics as object).length > 0) {
                            parts.push(`**Metrics:** ${JSON.stringify(r.report.metrics)}`);
                        }
                        return parts.join("\n");
                    });

                    return `## Run Reports (${reports.length} since ${sinceDate.toISOString().split("T")[0]})\n\n${lines.join("\n\n")}`;
                } catch (error) {
                    logger.error({ error }, "ceo_get_project_reports failed");
                    return `Failed to get reports: ${error instanceof Error ? error.message : "Unknown error"}`;
                }
            },
        })
    );

    tools.push(
        new DynamicStructuredTool({
            name: "ceo_get_agent_reports",
            description: "Get run reports for a specific agent across all projects.",
            schema: z.object({
                agentId: z.string().describe("ID of the agent"),
                since: z.string().optional().describe("ISO date string — only get reports since this date (defaults to 24h ago)"),
            }),
            func: async ({ agentId: targetAgentId, since }) => {
                try {
                    const sinceDate = since ? new Date(since) : new Date(Date.now() - 24 * 60 * 60 * 1000);
                    const reports = await runReportRepository.findByAgent(targetAgentId, workspaceId, { since: sinceDate });

                    if (reports.length === 0) return `No run reports for this agent since ${sinceDate.toISOString().split("T")[0]}.`;

                    const lines = reports.map((r) => {
                        const parts = [
                            `### ${r.createdAt.toISOString().split("T")[0]} (${r.runType})`,
                            `**Summary:** ${r.summary}`,
                        ];
                        if (r.actionsTaken) parts.push(`**Actions:** ${r.actionsTaken}`);
                        if (r.outcomes) parts.push(`**Outcomes:** ${r.outcomes}`);
                        if (r.issues) parts.push(`**Issues:** ${r.issues}`);
                        return parts.join("\n");
                    });

                    return `## Agent Reports (${reports.length})\n\n${lines.join("\n\n")}`;
                } catch (error) {
                    logger.error({ error }, "ceo_get_agent_reports failed");
                    return `Failed to get agent reports: ${error instanceof Error ? error.message : "Unknown error"}`;
                }
            },
        })
    );

    // ── Agent Instruction ──────────────────────────────────────────────────

    tools.push(
        new DynamicStructuredTool({
            name: "ceo_message_agent",
            description:
                "Send a direct instruction to an agent, triggering an on-demand run. " +
                "Use this to give agents specific tasks, adjust their behavior, or request immediate action. " +
                "The agent will execute the instruction and a run report will be generated.",
            schema: z.object({
                agentId: z.string().describe("ID of the agent to message"),
                message: z.string().describe("The instruction/message to send to the agent"),
            }),
            func: async ({ agentId: targetAgentId, message }) => {
                try {
                    // Dynamic import to avoid circular dependency
                    const { createAgentGraph } = await import("../graphs/agent.graph.ts");
                    const { HumanMessage: HM } = await import("@langchain/core/messages");

                    const startedAt = new Date();
                    const { graph } = await createAgentGraph(targetAgentId, workspaceId);
                    const threadId = `ceo-instruction-${Date.now()}`;
                    const result = await graph.invoke(
                        { messages: [new HM(message)] },
                        { configurable: { thread_id: threadId } }
                    );

                    const messages = result.messages;
                    const lastMsg = messages[messages.length - 1];
                    const resultText = typeof lastMsg.content === "string"
                        ? lastMsg.content
                        : JSON.stringify(lastMsg.content);

                    // Save run report
                    const agentProjects = await projectRepository.getProjectsForAgent(targetAgentId, workspaceId);
                    await runReportRepository.create({
                        workspaceId,
                        agentId: targetAgentId,
                        projectId: agentProjects.length > 0 ? agentProjects[0].id : null,
                        summary: `CEO-triggered run: ${message.substring(0, 200)}`,
                        actionsTaken: resultText.substring(0, 2000),
                        outcomes: null,
                        issues: null,
                        metrics: {},
                        data: {},
                        runType: "ceo_triggered",
                        startedAt,
                        completedAt: new Date(),
                    });

                    return `Agent response:\n${resultText.substring(0, 3000)}`;
                } catch (error) {
                    logger.error({ error }, "ceo_message_agent failed");
                    return `Failed to message agent: ${error instanceof Error ? error.message : "Unknown error"}`;
                }
            },
        })
    );

    return tools;
}
