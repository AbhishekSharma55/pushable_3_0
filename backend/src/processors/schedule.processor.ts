import { HumanMessage } from "@langchain/core/messages";
import { createAgentGraph } from "../graphs/agent.graph.ts";
import { scheduleService } from "../services/schedule.service.ts";
import { scheduleRepository } from "../repositories/schedule.repository.ts";
import { scheduleRunRepository } from "../repositories/schedule-run.repository.ts";
import { checkCredits, deductCredits, calculateCreditCost } from "../lib/credit-engine.ts";
import { logger } from "../lib/logger.ts";
import { removeJob } from "../lib/scheduler.ts";
import { runReportRepository } from "../repositories/runReport.repository.ts";
import { projectRepository } from "../repositories/project.repository.ts";

export async function processSchedule(data: {
    scheduleId: string;
    agentId: string;
    prompt: string;
    workspaceId: string;
}) {
    const { scheduleId, agentId, prompt, workspaceId } = data;
    logger.info({ scheduleId, agentId }, "Processing scheduled prompt");

    // Verify schedule still exists before creating a run
    const schedule = await scheduleRepository.findById(scheduleId, workspaceId);
    if (!schedule) {
        logger.warn({ scheduleId }, "Schedule no longer exists — removing orphaned job");
        await removeJob(scheduleId);
        return;
    }

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
        const { graph } = await createAgentGraph(agentId, workspaceId);

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

        // Generate run report
        try {
            const agentProjects = await projectRepository.getProjectsForAgent(agentId, workspaceId);
            await runReportRepository.create({
                workspaceId,
                agentId,
                projectId: agentProjects.length > 0 ? agentProjects[0].id : null,
                scheduleId,
                summary: resultText.substring(0, 1000),
                actionsTaken: `Executed scheduled task: ${prompt.substring(0, 500)}`,
                outcomes: resultText.substring(0, 2000),
                issues: null,
                metrics: {},
                data: {},
                runType: "scheduled",
                startedAt: new Date(startTime),
                completedAt: new Date(),
            });
        } catch (reportError) {
            logger.warn({ reportError, scheduleId }, "Failed to create run report for scheduled run");
        }

        logger.info({ scheduleId, resultLength: resultText.length, creditsUsed: estimatedCost }, "Scheduled prompt completed");
    } catch (error) {
        const errMsg = error instanceof Error ? error.message : "Unknown error";
        const durationMs = Date.now() - startTime;
        await scheduleRunRepository.updateFailed(run.id, errMsg, durationMs);

        // Save failed run report
        try {
            const agentProjects = await projectRepository.getProjectsForAgent(agentId, workspaceId);
            await runReportRepository.create({
                workspaceId,
                agentId,
                projectId: agentProjects.length > 0 ? agentProjects[0].id : null,
                scheduleId,
                summary: `Scheduled run failed: ${errMsg}`,
                actionsTaken: null,
                outcomes: null,
                issues: errMsg,
                metrics: {},
                data: {},
                runType: "scheduled",
                startedAt: new Date(startTime),
                completedAt: new Date(),
            });
        } catch (reportError) {
            logger.warn({ reportError, scheduleId }, "Failed to create failed run report");
        }

        logger.error({ scheduleId, error: errMsg }, "Scheduled prompt failed");
    }
}
