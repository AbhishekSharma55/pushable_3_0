import { HumanMessage } from "@langchain/core/messages";
import { createAgentGraph } from "../graphs/agent.graph.ts";
import { scheduleService } from "../services/schedule.service.ts";
import { scheduleRepository } from "../repositories/schedule.repository.ts";
import { logger } from "../lib/logger.ts";

export async function processSchedule(data: {
    scheduleId: string;
    agentId: string;
    prompt: string;
    workspaceId: string;
}) {
    const { scheduleId, agentId, prompt, workspaceId } = data;
    logger.info({ scheduleId, agentId }, "Processing scheduled prompt");

    // Handle humanization (delay, business hours check)
    const shouldRun = await scheduleService.executeWithHumanization(scheduleId);
    if (!shouldRun) {
        logger.info({ scheduleId }, "Scheduled run skipped — outside business hours");
        return;
    }

    try {
        const graph = await createAgentGraph(agentId, workspaceId);

        const result = await graph.invoke(
            { messages: [new HumanMessage(prompt)] },
            { configurable: { thread_id: `schedule-${scheduleId}` } }
        );

        const messages = result.messages;
        const lastMsg = messages[messages.length - 1];
        const resultText =
            typeof lastMsg.content === "string"
                ? lastMsg.content
                : JSON.stringify(lastMsg.content);

        // Update last run timestamp
        await scheduleRepository.updateLastRunAt(scheduleId);

        logger.info({ scheduleId, resultLength: resultText.length }, "Scheduled prompt completed");
    } catch (error) {
        const errMsg = error instanceof Error ? error.message : "Unknown error";
        logger.error({ scheduleId, error: errMsg }, "Scheduled prompt failed");
    }
}
