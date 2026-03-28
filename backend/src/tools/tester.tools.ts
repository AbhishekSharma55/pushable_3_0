import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { agentRepository } from "../repositories/agent.repository.ts";
import { permissionRepository } from "../repositories/permission.repository.ts";
import { integrationRepository } from "../repositories/integration.repository.ts";
import { kbRepository } from "../repositories/kb.repository.ts";
import { skillRepository } from "../repositories/skill.repository.ts";
import { toolRepository } from "../repositories/tool.repository.ts";
import { testSuiteRepository } from "../repositories/testSuite.repository.ts";
import { testCaseRepository } from "../repositories/testCase.repository.ts";
import { projectRepository } from "../repositories/project.repository.ts";
import { runReportRepository } from "../repositories/runReport.repository.ts";
import { logger } from "../lib/logger.ts";

interface TesterToolsConfig {
    agentId: string;
    workspaceId: string;
}

export function buildTesterTools(config: TesterToolsConfig): DynamicStructuredTool[] {
    const { agentId, workspaceId } = config;
    const tools: DynamicStructuredTool[] = [];

    // ── Get Agent Info ─────────────────────────────────────────────────────

    tools.push(
        new DynamicStructuredTool({
            name: "tester_get_agent_info",
            description:
                "Get the full configuration of an agent — system prompt, model, temperature, permissions, " +
                "accessible tools, KBs, skills, integrations, and projects. Use this to understand what an agent " +
                "does before generating test cases.",
            schema: z.object({
                agentId: z.string().describe("ID of the agent to inspect"),
            }),
            func: async ({ agentId: targetId }) => {
                try {
                    const agent = await agentRepository.findById(targetId, workspaceId);
                    if (!agent) return "Agent not found.";

                    const [toolPerms, kbPerms, skillPerms, agentPerms, integrations, projects] = await Promise.all([
                        permissionRepository.getPermissionsByType(targetId, workspaceId, "tool"),
                        permissionRepository.getPermissionsByType(targetId, workspaceId, "kb"),
                        permissionRepository.getPermissionsByType(targetId, workspaceId, "skill"),
                        permissionRepository.getPermissionsByType(targetId, workspaceId, "agent"),
                        integrationRepository.findByAgent(targetId, workspaceId),
                        projectRepository.getProjectsForAgent(targetId, workspaceId),
                    ]);

                    // Resolve names for tools, KBs, skills
                    const allowedToolIds = toolPerms.filter((p) => p.allowed).map((p) => p.resourceId);
                    const allowedKbIds = kbPerms.filter((p) => p.allowed).map((p) => p.resourceId);
                    const allowedSkillIds = skillPerms.filter((p) => p.allowed).map((p) => p.resourceId);
                    const allowedAgentIds = agentPerms.filter((p) => p.allowed).map((p) => p.resourceId);

                    const [toolDetails, kbDetails, skillDetails, agentDetails] = await Promise.all([
                        allowedToolIds.length > 0 ? toolRepository.findByIds(allowedToolIds) : Promise.resolve([]),
                        allowedKbIds.length > 0 ? kbRepository.findKBsByIds(allowedKbIds, workspaceId) : Promise.resolve([]),
                        allowedSkillIds.length > 0 ? skillRepository.findByIds(allowedSkillIds, workspaceId) : Promise.resolve([]),
                        Promise.all(allowedAgentIds.map(async (id) => {
                            const a = await agentRepository.findById(id, workspaceId);
                            return a ? { id: a.id, name: a.name } : null;
                        })).then((r) => r.filter(Boolean)),
                    ]);

                    const parts = [
                        `## Agent: ${agent.name} (ID: ${agent.id})`,
                        `Model: ${agent.model}`,
                        `Temperature: ${agent.temperature}`,
                        `Browser: ${agent.browserEnabled ? agent.browserType : "disabled"}`,
                        "",
                        `### System Prompt`,
                        agent.systemPrompt || "(empty)",
                        "",
                        `### System Permissions`,
                        `- systemLevelAccess: ${agent.systemLevelAccess}`,
                        `- canManageKB: ${agent.canManageKB}`,
                        `- canManageSkills: ${agent.canManageSkills}`,
                        `- canManageTools: ${agent.canManageTools}`,
                        `- canManageSchedules: ${agent.canManageSchedules}`,
                        `- canManageChannels: ${agent.canManageChannels}`,
                        `- canManageAgents: ${agent.canManageAgents}`,
                        `- canManageBucket: ${agent.canManageBucket}`,
                        `- canExecutePython: ${agent.canExecutePython}`,
                        "",
                        `### Tools (${toolDetails.length})`,
                        toolDetails.length > 0
                            ? toolDetails.map((t) => `- ${t.name} (${t.type})${t.description ? `: ${t.description}` : ""}`).join("\n")
                            : "  None",
                        "",
                        `### Knowledge Bases (${kbDetails.length})`,
                        kbDetails.length > 0
                            ? kbDetails.map((k) => `- ${k.name}${k.description ? `: ${k.description}` : ""}`).join("\n")
                            : "  None",
                        "",
                        `### Skills (${skillDetails.length})`,
                        skillDetails.length > 0
                            ? skillDetails.map((s) => `- ${s.name}${s.description ? `: ${s.description}` : ""}`).join("\n")
                            : "  None",
                        "",
                        `### Agent Delegation (${agentDetails.length})`,
                        agentDetails.length > 0
                            ? agentDetails.map((a: any) => `- ${a.name} (ID: ${a.id})`).join("\n")
                            : "  None",
                        "",
                        `### Integrations (${integrations.length})`,
                        integrations.length > 0
                            ? integrations.map((i) => `- ${i.connectionLabel || i.name} (${i.composioToolkitSlug}) — ${i.status}`).join("\n")
                            : "  None",
                        "",
                        `### Projects (${projects.length})`,
                        projects.length > 0
                            ? projects.map((p) => `- ${p.name} (${p.status})`).join("\n")
                            : "  None",
                    ];

                    return parts.join("\n");
                } catch (error) {
                    logger.error({ error }, "tester_get_agent_info failed");
                    return `Failed to get agent info: ${error instanceof Error ? error.message : "Unknown error"}`;
                }
            },
        })
    );

    // ── Create Test Suite ──────────────────────────────────────────────────

    tools.push(
        new DynamicStructuredTool({
            name: "tester_create_test_suite",
            description:
                "Create a test suite with test cases for an agent. Provide all test cases at once. " +
                "Each test case needs: title, input (the message to send), and expectedBehavior (what should happen).",
            schema: z.object({
                agentId: z.string().describe("ID of the agent to test"),
                name: z.string().describe("Test suite name (e.g. 'Expense Manager - Full Suite')"),
                description: z.string().optional().describe("Suite description"),
                cases: z.array(z.object({
                    title: z.string().describe("Test case title (e.g. 'Add basic expense')"),
                    input: z.string().describe("The exact message to send to the agent"),
                    expectedBehavior: z.string().describe("What the agent should do — be specific and evaluatable"),
                })).describe("Array of test cases"),
            }),
            func: async ({ agentId: targetId, name, description, cases }) => {
                try {
                    const suite = await testSuiteRepository.create({
                        workspaceId,
                        agentId: targetId,
                        name,
                        description,
                        status: "draft",
                        createdBy: agentId,
                    });

                    const testCases = await testCaseRepository.createMany(
                        cases.map((c) => ({
                            suiteId: suite.id,
                            workspaceId,
                            title: c.title,
                            input: c.input,
                            expectedBehavior: c.expectedBehavior,
                        }))
                    );

                    return `Created test suite "${name}" (ID: ${suite.id}) with ${testCases.length} test cases for agent ${targetId}.`;
                } catch (error) {
                    logger.error({ error }, "tester_create_test_suite failed");
                    return `Failed to create test suite: ${error instanceof Error ? error.message : "Unknown error"}`;
                }
            },
        })
    );

    // ── Run Single Test ────────────────────────────────────────────────────

    tools.push(
        new DynamicStructuredTool({
            name: "tester_run_test",
            description:
                "Run a single test case: send the input to the target agent, capture the response, " +
                "and evaluate whether it matches the expected behavior. Updates the test case with results.",
            schema: z.object({
                testCaseId: z.string().describe("ID of the test case to run"),
            }),
            func: async ({ testCaseId }) => {
                try {
                    const testCase = await testCaseRepository.findById(testCaseId, workspaceId);
                    if (!testCase) return "Test case not found.";

                    const suite = await testSuiteRepository.findById(testCase.suiteId, workspaceId);
                    if (!suite) return "Test suite not found.";

                    // Execute the test — send message to target agent
                    const { createAgentGraph } = await import("../graphs/agent.graph.ts");
                    const { HumanMessage: HM } = await import("@langchain/core/messages");

                    const startTime = Date.now();
                    const { graph } = await createAgentGraph(suite.agentId, workspaceId);
                    const threadId = `test-${testCaseId}-${Date.now()}`;

                    const result = await graph.invoke(
                        { messages: [new HM(testCase.input)] },
                        { configurable: { thread_id: threadId } }
                    );

                    const messages = result.messages;
                    const lastMsg = messages[messages.length - 1];
                    const responseText = typeof lastMsg.content === "string"
                        ? lastMsg.content
                        : JSON.stringify(lastMsg.content);
                    const executionTimeMs = Date.now() - startTime;

                    // Update test case with response (evaluation happens separately by the tester)
                    await testCaseRepository.update(testCaseId, workspaceId, {
                        actualResponse: responseText.substring(0, 5000),
                        executionTimeMs,
                        executedAt: new Date(),
                    });

                    return `## Test: ${testCase.title}\n**Input:** ${testCase.input}\n**Expected:** ${testCase.expectedBehavior}\n**Actual Response (${executionTimeMs}ms):**\n${responseText.substring(0, 3000)}\n\nNow evaluate this result and use tester_evaluate_test to record pass/fail.`;
                } catch (error) {
                    // Mark as error
                    await testCaseRepository.update(testCaseId, workspaceId, {
                        status: "error",
                        evaluationNotes: error instanceof Error ? error.message : "Unknown error",
                        executedAt: new Date(),
                    }).catch(() => {});

                    logger.error({ error }, "tester_run_test failed");
                    return `Test execution failed: ${error instanceof Error ? error.message : "Unknown error"}`;
                }
            },
        })
    );

    // ── Evaluate Test ──────────────────────────────────────────────────────

    tools.push(
        new DynamicStructuredTool({
            name: "tester_evaluate_test",
            description:
                "Record the evaluation of a test case after reviewing the actual response. " +
                "Mark it as passed, failed, or error with evaluation notes explaining why.",
            schema: z.object({
                testCaseId: z.string().describe("ID of the test case"),
                status: z.enum(["passed", "failed", "error"]).describe("Test result"),
                evaluationNotes: z.string().describe("Explanation of why the test passed or failed"),
            }),
            func: async ({ testCaseId, status, evaluationNotes }) => {
                try {
                    const updated = await testCaseRepository.update(testCaseId, workspaceId, {
                        status,
                        evaluationNotes,
                    });
                    if (!updated) return "Test case not found.";
                    return `Test "${updated.title}" marked as ${status.toUpperCase()}.`;
                } catch (error) {
                    logger.error({ error }, "tester_evaluate_test failed");
                    return `Failed to evaluate test: ${error instanceof Error ? error.message : "Unknown error"}`;
                }
            },
        })
    );

    // ── Run Full Suite ─────────────────────────────────────────────────────

    tools.push(
        new DynamicStructuredTool({
            name: "tester_run_suite",
            description:
                "Run all pending test cases in a suite sequentially. For each test, sends the input to the target agent, " +
                "captures the response, and returns all results for you to evaluate. " +
                "After running, use tester_evaluate_test for each case.",
            schema: z.object({
                suiteId: z.string().describe("ID of the test suite to run"),
            }),
            func: async ({ suiteId }) => {
                try {
                    const suite = await testSuiteRepository.findById(suiteId, workspaceId);
                    if (!suite) return "Test suite not found.";

                    // Mark suite as running
                    await testSuiteRepository.update(suiteId, workspaceId, { status: "running" });

                    const cases = await testCaseRepository.findBySuite(suiteId, workspaceId);
                    const pendingCases = cases.filter((c) => c.status === "pending");

                    if (pendingCases.length === 0) return "No pending test cases to run.";

                    const { createAgentGraph } = await import("../graphs/agent.graph.ts");
                    const { HumanMessage: HM } = await import("@langchain/core/messages");

                    const results: string[] = [];

                    for (const tc of pendingCases) {
                        try {
                            const startTime = Date.now();
                            const { graph } = await createAgentGraph(suite.agentId, workspaceId);
                            const threadId = `test-${tc.id}-${Date.now()}`;

                            const result = await graph.invoke(
                                { messages: [new HM(tc.input)] },
                                { configurable: { thread_id: threadId } }
                            );

                            const messages = result.messages;
                            const lastMsg = messages[messages.length - 1];
                            const responseText = typeof lastMsg.content === "string"
                                ? lastMsg.content
                                : JSON.stringify(lastMsg.content);
                            const executionTimeMs = Date.now() - startTime;

                            await testCaseRepository.update(tc.id, workspaceId, {
                                actualResponse: responseText.substring(0, 5000),
                                executionTimeMs,
                                executedAt: new Date(),
                            });

                            results.push(`### ${tc.title} (${executionTimeMs}ms)\n**Input:** ${tc.input}\n**Expected:** ${tc.expectedBehavior}\n**Response:** ${responseText.substring(0, 1000)}\n**Test Case ID:** ${tc.id}`);
                        } catch (err) {
                            await testCaseRepository.update(tc.id, workspaceId, {
                                status: "error",
                                evaluationNotes: err instanceof Error ? err.message : "Execution failed",
                                executedAt: new Date(),
                            });
                            results.push(`### ${tc.title} — ERROR\n${err instanceof Error ? err.message : "Unknown error"}\n**Test Case ID:** ${tc.id}`);
                        }
                    }

                    // Mark suite as completed
                    await testSuiteRepository.update(suiteId, workspaceId, { status: "completed" });

                    return `## Suite Run Complete (${pendingCases.length} tests)\n\n${results.join("\n\n")}\n\nNow evaluate each test using tester_evaluate_test with the test case IDs above.`;
                } catch (error) {
                    logger.error({ error }, "tester_run_suite failed");
                    return `Failed to run suite: ${error instanceof Error ? error.message : "Unknown error"}`;
                }
            },
        })
    );

    // ── List Suites ────────────────────────────────────────────────────────

    tools.push(
        new DynamicStructuredTool({
            name: "tester_list_suites",
            description: "List all test suites in the workspace, optionally filtered by agent.",
            schema: z.object({
                agentId: z.string().optional().describe("Filter by agent ID (optional)"),
            }),
            func: async ({ agentId: targetId }) => {
                try {
                    let suites;
                    if (targetId) {
                        suites = await testSuiteRepository.findByAgent(targetId, workspaceId);
                    } else {
                        const rows = await testSuiteRepository.findByWorkspace(workspaceId);
                        suites = rows.map((r) => ({ ...r.suite, agentName: r.agent.name, agentEmoji: r.agent.emoji }));
                    }

                    if (suites.length === 0) return "No test suites found.";

                    const lines = await Promise.all(
                        suites.map(async (s: any) => {
                            const stats = await testCaseRepository.getStatsForSuite(s.id, workspaceId);
                            const agentLabel = s.agentName ? `${s.agentEmoji || ""} ${s.agentName}` : s.agentId;
                            return `- **${s.name}** (ID: ${s.id}) — Agent: ${agentLabel} — Status: ${s.status} — Tests: ${stats.passed}/${stats.total} passed`;
                        })
                    );

                    return `Test Suites (${suites.length}):\n${lines.join("\n")}`;
                } catch (error) {
                    logger.error({ error }, "tester_list_suites failed");
                    return `Failed to list suites: ${error instanceof Error ? error.message : "Unknown error"}`;
                }
            },
        })
    );

    // ── Get Suite Results ──────────────────────────────────────────────────

    tools.push(
        new DynamicStructuredTool({
            name: "tester_get_results",
            description: "Get detailed results for a test suite — all test cases with their status, response, and evaluation.",
            schema: z.object({
                suiteId: z.string().describe("ID of the test suite"),
            }),
            func: async ({ suiteId }) => {
                try {
                    const suite = await testSuiteRepository.findByIdWithCases(suiteId, workspaceId);
                    if (!suite) return "Test suite not found.";

                    const stats = await testCaseRepository.getStatsForSuite(suiteId, workspaceId);

                    const parts = [
                        `## ${suite.name}`,
                        `Agent: ${suite.agent?.name || suite.agentId} | Status: ${suite.status}`,
                        `Results: ${stats.passed} passed, ${stats.failed} failed, ${stats.error} errors, ${stats.pending} pending (${stats.total} total)`,
                        "",
                    ];

                    for (const tc of suite.cases) {
                        const icon = tc.status === "passed" ? "✅" : tc.status === "failed" ? "❌" : tc.status === "error" ? "⚠️" : "⏳";
                        parts.push(`### ${icon} ${tc.title}`);
                        parts.push(`**Input:** ${tc.input}`);
                        parts.push(`**Expected:** ${tc.expectedBehavior}`);
                        if (tc.actualResponse) parts.push(`**Response:** ${tc.actualResponse.substring(0, 500)}`);
                        if (tc.evaluationNotes) parts.push(`**Evaluation:** ${tc.evaluationNotes}`);
                        if (tc.executionTimeMs) parts.push(`**Time:** ${tc.executionTimeMs}ms`);
                        parts.push("");
                    }

                    return parts.join("\n");
                } catch (error) {
                    logger.error({ error }, "tester_get_results failed");
                    return `Failed to get results: ${error instanceof Error ? error.message : "Unknown error"}`;
                }
            },
        })
    );

    return tools;
}
