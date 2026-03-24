import { HumanMessage } from "@langchain/core/messages";
import { createAgentGraph } from "../graphs/agent.graph.ts";
import { scheduleService } from "../services/schedule.service.ts";
import { scheduleRepository } from "../repositories/schedule.repository.ts";
import { scheduleRunRepository } from "../repositories/schedule-run.repository.ts";
import { checkCredits, deductCredits, calculateCreditCost } from "../lib/credit-engine.ts";
import { logger } from "../lib/logger.ts";

export async function processSchedule(data: {
    scheduleId: string;
    agentId: string;
    prompt: string;
    workspaceId: string;
}) {
    const { scheduleId, agentId, prompt, workspaceId } = data;
    logger.info({ scheduleId, agentId }, "Processing scheduled prompt");

    // Create run record
    const run = await scheduleRunRepository.create({ scheduleId, workspaceId });
    const startTime = Date.now();

    // Handle humanization (delay, business hours check)
    const shouldRun = await scheduleService.executeWithHumanization(scheduleId);
    if (!shouldRun) {
        logger.info({ scheduleId }, "Scheduled run skipped — outside business hours");
        await scheduleRunRepository.updateSkipped(run.id);
        return;
    }

    // Check credits before running
    const estimatedCost = calculateCreditCost({ action: "scheduled_run", isScheduled: true });
    const creditCheck = await checkCredits(workspaceId, estimatedCost);
    if (!creditCheck.allowed) {
        const durationMs = Date.now() - startTime;
        await scheduleRunRepository.updateFailed(
            run.id,
            `Insufficient credits: ${creditCheck.reason}`,
            durationMs
        );
        logger.warn({ scheduleId, reason: creditCheck.reason }, "Scheduled run failed — insufficient credits");
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

        const durationMs = Date.now() - startTime;

        // Deduct credits
        const deductResult = await deductCredits({
            workspaceId,
            amount: estimatedCost,
            type: "scheduled_run_fee",
            metadata: { scheduleId, agentId, durationMs },
        });

        // Record completed run
        await scheduleRunRepository.updateCompleted(run.id, {
            resultText,
            creditsUsed: deductResult.success ? estimatedCost : 0,
            durationMs,
        });

        // Update last run timestamp
        await scheduleRepository.updateLastRunAt(scheduleId);

        logger.info({ scheduleId, resultLength: resultText.length, creditsUsed: estimatedCost }, "Scheduled prompt completed");
    } catch (error) {
        const errMsg = error instanceof Error ? error.message : "Unknown error";
        const durationMs = Date.now() - startTime;
        await scheduleRunRepository.updateFailed(run.id, errMsg, durationMs);
        logger.error({ scheduleId, error: errMsg }, "Scheduled prompt failed");
    }
}
