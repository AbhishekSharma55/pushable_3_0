import { HumanMessage } from "@langchain/core/messages";
import { taskRepository } from "../repositories/task.repository.ts";
import { createAgentGraph } from "../graphs/agent.graph.ts";
import { logger } from "../lib/logger.ts";

export async function processTask(data: {
    taskId: string;
    workspaceId: string;
}) {
    const { taskId, workspaceId } = data;
    logger.info({ taskId }, "Processing task");

    try {
        const task = await taskRepository.findById(taskId, workspaceId);
        if (!task) {
            logger.error({ taskId }, "Task not found");
            return;
        }

        await taskRepository.updateStatus(taskId, "running");

        const graph = await createAgentGraph(task.agentId, workspaceId);

        const userMessage = task.description
            ? `${task.title}\n\n${task.description}`
            : task.title;

        const result = await graph.invoke(
            { messages: [new HumanMessage(userMessage)] },
            { configurable: { thread_id: `task-${taskId}` } }
        );

        // Extract the last AI message content
        const messages = result.messages;
        const lastMsg = messages[messages.length - 1];
        const resultText =
            typeof lastMsg.content === "string"
                ? lastMsg.content
                : JSON.stringify(lastMsg.content);

        await taskRepository.updateStatus(taskId, "done", resultText);
        logger.info({ taskId }, "Task completed");
    } catch (error) {
        const errMsg =
            error instanceof Error ? error.message : "Unknown error";
        logger.error({ taskId, error: errMsg }, "Task failed");
        await taskRepository.updateStatus(taskId, "failed", errMsg);
    }
}
