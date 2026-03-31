import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { credits, creditLedger } from "../db/schema/index.ts";
import { logger } from "./logger.ts";

// --- Base costs (before multiplier) ---

export const BASE_CREDIT_COSTS = {
    CHAT_MESSAGE_BASE: 5,
    TASK_RUN_BASE: 100,
    WORKFLOW_STEP_BASE: 2,
    KB_DOCUMENT_UPLOAD: 20,
    KB_QUERY: 2,
    BROWSER_ACTION: 10,
    SCHEDULED_RUN_FEE: 10,
    AGENT_DELEGATION_MULTIPLIER: 2,
} as const;

// --- Types ---

export type LedgerType =
    | "subscription_grant"
    | "topup"
    | "chat_message"
    | "task_run"
    | "workflow_step"
    | "workflow_run"
    | "kb_upload"
    | "kb_query"
    | "browser_action"
    | "scheduled_run_fee"
    | "agent_delegation"
    | "overage"
    | "refund"
    | "manual_adjustment";

export type CreditAction =
    | "chat_message"
    | "task_run"
    | "workflow_step"
    | "workflow_run"
    | "kb_upload"
    | "kb_query"
    | "browser_action"
    | "scheduled_run"
    | "agent_delegation";

interface CalculateCostParams {
    action: CreditAction;
    modelMultiplier?: number;
    isScheduled?: boolean;
    isDelegation?: boolean;
    stepCount?: number;
}

interface CheckResult {
    allowed: boolean;
    available: number;
    reason?: "insufficient_credits" | "overage_disabled" | "overage_limit_exceeded";
}

interface DeductParams {
    workspaceId: string;
    amount: number;
    type: LedgerType;
    metadata: Record<string, unknown>;
}

interface DeductResult {
    success: boolean;
    creditsAfter: number;
}

interface AddParams {
    workspaceId: string;
    amount: number;
    type: "subscription_grant" | "topup" | "refund" | "manual_adjustment";
    metadata: Record<string, unknown>;
}

interface BalanceInfo {
    planCredits: number;
    topupCredits: number;
    availableCredits: number;
    overageEnabled: boolean;
    overageLimit: number;
    totalConsumed: number;
}

// --- Plan tier ordering ---

const PLAN_ORDER: Record<string, number> = {
    free: 0,
    starter: 1,
    pro: 2,
    scale: 3,
};

export function isPlanSufficient(
    workspacePlan: string,
    requiredPlan: string
): boolean {
    return (PLAN_ORDER[workspacePlan] ?? 0) >= (PLAN_ORDER[requiredPlan] ?? 0);
}

// --- Core functions ---

export function calculateCreditCost(params: CalculateCostParams): number {
    const { action, modelMultiplier = 1.0, isScheduled = false, isDelegation = false } = params;

    let cost: number;

    switch (action) {
        case "chat_message":
            cost = BASE_CREDIT_COSTS.CHAT_MESSAGE_BASE * modelMultiplier;
            break;
        case "task_run":
            cost = BASE_CREDIT_COSTS.TASK_RUN_BASE * modelMultiplier;
            break;
        case "workflow_step":
            cost = BASE_CREDIT_COSTS.WORKFLOW_STEP_BASE * modelMultiplier;
            break;
        case "workflow_run":
            cost = BASE_CREDIT_COSTS.WORKFLOW_STEP_BASE * (params.stepCount || 1);
            break;
        case "kb_upload":
            return BASE_CREDIT_COSTS.KB_DOCUMENT_UPLOAD;
        case "kb_query":
            return BASE_CREDIT_COSTS.KB_QUERY;
        case "browser_action":
            return BASE_CREDIT_COSTS.BROWSER_ACTION;
        case "scheduled_run":
            cost = BASE_CREDIT_COSTS.TASK_RUN_BASE * modelMultiplier;
            break;
        case "agent_delegation":
            cost = BASE_CREDIT_COSTS.CHAT_MESSAGE_BASE * modelMultiplier * BASE_CREDIT_COSTS.AGENT_DELEGATION_MULTIPLIER;
            break;
        default:
            cost = 1;
    }

    if (isScheduled) {
        cost += BASE_CREDIT_COSTS.SCHEDULED_RUN_FEE;
    }

    if (isDelegation && action !== "agent_delegation") {
        cost *= BASE_CREDIT_COSTS.AGENT_DELEGATION_MULTIPLIER;
    }

    return Math.max(1, Math.ceil(cost));
}

export async function checkCredits(
    workspaceId: string,
    requiredCredits: number
): Promise<CheckResult> {
    const row = await db
        .select()
        .from(credits)
        .where(eq(credits.workspaceId, workspaceId))
        .limit(1);

    if (row.length === 0) {
        return { allowed: false, available: 0, reason: "insufficient_credits" };
    }

    const c = row[0];
    const available = c.planCredits + c.topupCredits;

    if (available >= requiredCredits) {
        return { allowed: true, available };
    }

    if (!c.overageEnabled) {
        return { allowed: false, available, reason: "overage_disabled" };
    }

    // With overage: allow if deficit won't exceed overage limit
    const deficit = requiredCredits - available;
    if (deficit <= c.overageLimit) {
        return { allowed: true, available };
    }

    return { allowed: false, available, reason: "overage_limit_exceeded" };
}

export async function deductCredits(params: DeductParams): Promise<DeductResult> {
    const { workspaceId, amount, type, metadata } = params;

    try {
        const row = await db
            .select()
            .from(credits)
            .where(eq(credits.workspaceId, workspaceId))
            .limit(1);

        if (row.length === 0) {
            return { success: false, creditsAfter: 0 };
        }

        const c = row[0];
        let planDeduct = 0;
        let topupDeduct = 0;
        let remaining = amount;

        // Deduct from planCredits first
        if (c.planCredits > 0) {
            planDeduct = Math.min(c.planCredits, remaining);
            remaining -= planDeduct;
        }

        // Then from topupCredits
        if (remaining > 0 && c.topupCredits > 0) {
            topupDeduct = Math.min(c.topupCredits, remaining);
            remaining -= topupDeduct;
        }

        // Any remaining goes as negative planCredits (overage)
        if (remaining > 0) {
            planDeduct += remaining; // will make planCredits negative
        }

        const newPlan = c.planCredits - planDeduct;
        const newTopup = c.topupCredits - topupDeduct;
        const newBalance = newPlan + newTopup;
        const newTotalConsumed = c.totalCreditsConsumed + amount;

        await db
            .update(credits)
            .set({
                planCredits: newPlan,
                topupCredits: newTopup,
                balance: newBalance,
                totalCreditsConsumed: newTotalConsumed,
                updatedAt: new Date(),
            })
            .where(eq(credits.workspaceId, workspaceId));

        // Insert ledger entry
        await db.insert(creditLedger).values({
            workspaceId,
            amount: -amount,
            type,
            creditsAfter: newBalance,
            metadata,
        });

        return { success: true, creditsAfter: newBalance };
    } catch (error) {
        logger.error({ error, workspaceId, amount, type }, "Failed to deduct credits");
        return { success: false, creditsAfter: 0 };
    }
}

export async function addCredits(params: AddParams): Promise<{ creditsAfter: number }> {
    const { workspaceId, amount, type, metadata } = params;

    const row = await db
        .select()
        .from(credits)
        .where(eq(credits.workspaceId, workspaceId))
        .limit(1);

    if (row.length === 0) {
        throw new Error(`No credits record for workspace ${workspaceId}`);
    }

    const c = row[0];
    let newPlan = c.planCredits;
    let newTopup = c.topupCredits;

    if (type === "subscription_grant") {
        newPlan += amount;
    } else {
        // topup, refund, manual_adjustment go to topup bucket
        newTopup += amount;
    }

    const newBalance = newPlan + newTopup;

    await db
        .update(credits)
        .set({
            planCredits: newPlan,
            topupCredits: newTopup,
            balance: newBalance,
            updatedAt: new Date(),
        })
        .where(eq(credits.workspaceId, workspaceId));

    await db.insert(creditLedger).values({
        workspaceId,
        amount,
        type,
        creditsAfter: newBalance,
        metadata,
    });

    return { creditsAfter: newBalance };
}

export async function getBalance(workspaceId: string): Promise<BalanceInfo> {
    const row = await db
        .select()
        .from(credits)
        .where(eq(credits.workspaceId, workspaceId))
        .limit(1);

    if (row.length === 0) {
        return {
            planCredits: 0,
            topupCredits: 0,
            availableCredits: 0,
            overageEnabled: false,
            overageLimit: 0,
            totalConsumed: 0,
        };
    }

    const c = row[0];
    return {
        planCredits: c.planCredits,
        topupCredits: c.topupCredits,
        availableCredits: c.planCredits + c.topupCredits,
        overageEnabled: c.overageEnabled,
        overageLimit: c.overageLimit,
        totalConsumed: c.totalCreditsConsumed,
    };
}
