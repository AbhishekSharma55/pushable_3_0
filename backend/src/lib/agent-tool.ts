import { DynamicStructuredTool } from "@langchain/core/tools";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import { agentRepository } from "../repositories/agent.repository.ts";
import { createAgentGraph } from "../graphs/agent.graph.ts";
import { logger } from "./logger.ts";

/**
 * Build a LangChain tool that calls another agent as if it were a tool.
 * The caller agent can delegate work to the target agent.
 */
export async function buildAgentCallerTool(
    callerAgentId: string,
    targetAgentId: string,
    workspaceId: string
): Promise<DynamicStructuredTool | null> {
    const targetAgent = await agentRepository.findById(
        targetAgentId,
        workspaceId
    );
    if (!targetAgent) {
        logger.warn(
            { callerAgentId, targetAgentId },
            "Target agent not found for agent-as-tool, skipping"
        );
        return null;
    }

    const toolName = `agent_${targetAgent.name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase()}`;

    return new DynamicStructuredTool({
        name: toolName,
        description: `Call agent "${targetAgent.name}". Use this to delegate tasks to this agent. It will process your message and return its response.`,
        schema: z.object({
            message: z
                .string()
                .describe("The message/task to send to this agent"),
        }),
        func: async ({ message }) => {
            const threadId = `agent-call-${callerAgentId}-${targetAgentId}-${Date.now()}`;

            logger.info(
                {
                    callerAgentId,
                    targetAgentId,
                    targetName: targetAgent.name,
                    threadId,
                },
                "Agent-to-agent call started"
            );

            try {
                const { graph } = await createAgentGraph(
                    targetAgentId,
                    workspaceId
                );

                const result = await graph.invoke(
                    { messages: [new HumanMessage(message)] },
                    { configurable: { thread_id: threadId }, recursionLimit: 30 }
                );

                const messages = result.messages;
                const lastMsg = messages[messages.length - 1];
                const responseText =
                    typeof lastMsg.content === "string"
                        ? lastMsg.content
                        : JSON.stringify(lastMsg.content);

                logger.info(
                    {
                        callerAgentId,
                        targetAgentId,
                        responseLength: responseText.length,
                    },
                    "Agent-to-agent call completed"
                );

                return responseText;
            } catch (error) {
                const errMsg =
                    error instanceof Error ? error.message : "Unknown error";
                logger.error(
                    { callerAgentId, targetAgentId, error: errMsg },
                    "Agent-to-agent call failed"
                );
                return `Agent "${targetAgent.name}" failed to respond: ${errMsg}`;
            }
        },
    });
}
