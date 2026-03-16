import { HumanMessage } from "@langchain/core/messages";
import { workflowRepository } from "../repositories/workflow.repository.ts";
import { taskRepository } from "../repositories/task.repository.ts";
import { createAgentGraph } from "../graphs/agent.graph.ts";
import { logger } from "../lib/logger.ts";

export async function processWorkflow(data: {
    workflowId: string;
    workspaceId: string;
}) {
    const { workflowId, workspaceId } = data;
    logger.info({ workflowId }, "Processing workflow");

    try {
        const steps = await workflowRepository.getSteps(
            workflowId,
            workspaceId
        );

        if (steps.length === 0) {
            logger.warn({ workflowId }, "Workflow has no steps");
            return;
        }

        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            const task = await taskRepository.findById(
                step.taskId,
                workspaceId
            );
            if (!task) {
                logger.error(
                    { stepId: step.id, taskId: step.taskId },
                    "Task not found for workflow step, stopping"
                );
                break;
            }

            logger.info(
                {
                    workflowId,
                    step: i + 1,
                    totalSteps: steps.length,
                    taskId: task.id,
                    taskTitle: task.title,
                },
                "Executing workflow step"
            );

            await taskRepository.updateStatus(task.id, "running");

            try {
                const graph = await createAgentGraph(
                    task.agentId,
                    workspaceId
                );

                const userMessage = task.description
                    ? `${task.title}\n\n${task.description}`
                    : task.title;

                const result = await graph.invoke(
                    { messages: [new HumanMessage(userMessage)] },
                    { configurable: { thread_id: `task-${task.id}` } }
                );

                const messages = result.messages;
                const lastMsg = messages[messages.length - 1];
                const resultText =
                    typeof lastMsg.content === "string"
                        ? lastMsg.content
                        : JSON.stringify(lastMsg.content);

                await taskRepository.updateStatus(
                    task.id,
                    "done",
                    resultText
                );
                logger.info(
                    { workflowId, step: i + 1, taskId: task.id },
                    "Workflow step completed"
                );
            } catch (error) {
                const errMsg =
                    error instanceof Error ? error.message : "Unknown error";
                logger.error(
                    { workflowId, step: i + 1, taskId: task.id, error: errMsg },
                    "Workflow step failed, stopping workflow"
                );
                await taskRepository.updateStatus(
                    task.id,
                    "failed",
                    errMsg
                );
                return; // Stop workflow execution
            }
        }

        logger.info({ workflowId }, "Workflow completed successfully");
    } catch (error) {
        logger.error({ workflowId, error }, "Workflow processing error");
    }
}
