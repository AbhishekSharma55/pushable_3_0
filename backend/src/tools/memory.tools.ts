import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { memoryRepository } from "../repositories/memory.repository.ts";
import { logger } from "../lib/logger.ts";

export function buildMemoryTools(opts: {
    workspaceId: string;
    agentId: string;
    userId: string;
}): DynamicStructuredTool[] {
    const { workspaceId, agentId, userId } = opts;

    const saveMemory = new DynamicStructuredTool({
        name: "save_memory",
        description:
            "Save important information about the user to long-term memory so you can recall it in future conversations. " +
            "You MUST use this tool aggressively. Save whenever the user shares ANY of the following:\n" +
            "- Processes, workflows, or step-by-step instructions (e.g. 'When deploying, first run tests, then build, then push to staging')\n" +
            "- How they want tasks done (e.g. 'Always format reports as bullet points with headers')\n" +
            "- Rules, patterns, or standard operating procedures (e.g. 'Bug reports must include reproduction steps')\n" +
            "- Preferences, facts, decisions, or corrections (e.g. 'User prefers TypeScript over JavaScript')\n" +
            "- Project-specific knowledge (e.g. 'The API gateway is at api.example.com, auth uses JWT tokens')\n" +
            "If the user explains how to do something or corrects your approach, ALWAYS save it as a process memory so you never need to be told twice.",
        schema: z.object({
            content: z
                .string()
                .describe(
                    "The information to remember, written as a clear, detailed, standalone statement. " +
                    "For processes, include ALL steps in order. " +
                    "E.g. 'User's name is Alice', 'User prefers dark mode', " +
                    "'Process for submitting reports: 1) Gather data from dashboard 2) Format as PDF 3) Email to team-lead@company.com with subject line [Weekly Report]', " +
                    "'When user asks to deploy: always run tests first, then build Docker image, then push to staging, wait for approval, then push to production'."
                ),
            category: z
                .enum(["preference", "fact", "decision", "process", "general"])
                .optional()
                .describe("Category of the memory. Use 'process' for workflows, instructions, and how-to procedures."),
        }),
        func: async ({ content, category }) => {
            try {
                await memoryRepository.create({
                    workspaceId,
                    agentId,
                    userId,
                    content,
                    category: category || "general",
                });
                return `Memory saved: "${content}"`;
            } catch (error) {
                logger.error({ error }, "Failed to save memory");
                return "Failed to save memory.";
            }
        },
    });

    return [saveMemory];
}
