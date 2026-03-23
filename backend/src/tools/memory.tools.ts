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
            "Save an important piece of information about the user to long-term memory. " +
            "Use this when the user shares preferences, facts about themselves, important decisions, " +
            "or anything you should remember across future conversations. " +
            "Examples: user's name, timezone, preferred language, project details, preferences.",
        schema: z.object({
            content: z
                .string()
                .describe(
                    "The fact or preference to remember, written as a clear statement. " +
                    "E.g. 'User's name is Alice', 'User prefers dark mode', 'User works on Project X'."
                ),
            category: z
                .enum(["preference", "fact", "decision", "general"])
                .optional()
                .describe("Category of the memory"),
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
