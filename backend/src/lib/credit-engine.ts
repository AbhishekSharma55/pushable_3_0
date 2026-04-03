import { eq, and, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { credits, creditLedger, userCreditLimits, workspaces, creditCostRanges, creditCostMultipliers } from "../db/schema/index.ts";
import { logger } from "./logger.ts";

// --- Helper: numeric columns come back as strings from Drizzle ---

function n(val: string | number): number {
    return typeof val === "string" ? parseFloat(val) : val;
}

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
    userLimitExceeded?: boolean;
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

// --- Range-based credit lookup with in-memory cache ---

interface CachedRange {
    minDollar: number;
    maxDollar: number;
    creditAmount: number;
}

let rangesCache: CachedRange[] | null = null;
let rangesCacheTimestamp = 0;
const RANGES_CACHE_TTL_MS = 60_000; // 60 seconds

async function loadCreditRanges(): Promise<CachedRange[]> {
    const now = Date.now();
    if (rangesCache && now - rangesCacheTimestamp < RANGES_CACHE_TTL_MS) {
        return rangesCache;
    }

    try {
        const rows = await db
            .select()
            .from(creditCostRanges)
            .where(eq(creditCostRanges.isActive, true))
            .orderBy(creditCostRanges.minDollar);

        rangesCache = rows.map((r) => ({
            minDollar: n(r.minDollar),
            maxDollar: n(r.maxDollar),
            creditAmount: n(r.creditAmount),
        }));
        rangesCacheTimestamp = now;
        return rangesCache;
    } catch (error) {
        logger.warn({ error }, "Failed to load credit cost ranges, using empty list");
        return [];
    }
}

// --- Multiplier-based credit lookup with in-memory cache ---

interface CachedMultiplier {
    aboveDollar: number;
    multiplier: number;
}

let multipliersCache: CachedMultiplier[] | null = null;
let multipliersCacheTimestamp = 0;

async function loadCreditMultipliers(): Promise<CachedMultiplier[]> {
    const now = Date.now();
    if (multipliersCache && now - multipliersCacheTimestamp < RANGES_CACHE_TTL_MS) {
        return multipliersCache;
    }

    try {
        const rows = await db
            .select()
            .from(creditCostMultipliers)
            .where(eq(creditCostMultipliers.isActive, true))
            .orderBy(creditCostMultipliers.aboveDollar);

        // Sort descending so we match the highest threshold first
        multipliersCache = rows
            .map((r) => ({
                aboveDollar: n(r.aboveDollar),
                multiplier: n(r.multiplier),
            }))
            .sort((a, b) => b.aboveDollar - a.aboveDollar);
        multipliersCacheTimestamp = now;
        return multipliersCache;
    } catch (error) {
        logger.warn({ error }, "Failed to load credit cost multipliers, using empty list");
        return [];
    }
}

/** Force-refresh the cached ranges and multipliers (call after admin updates) */
export function invalidateCreditRangesCache(): void {
    rangesCache = null;
    rangesCacheTimestamp = 0;
    multipliersCache = null;
    multipliersCacheTimestamp = 0;
}

/**
 * Look up the credit amount for a given dollar cost.
 *
 * 1. Try configured ranges first (min <= cost < max → fixed credit amount)
 * 2. If no range matches, try multiplier tiers (cost above threshold → cost × multiplier)
 * 3. If nothing matches, return null (caller falls back to old formula)
 */
export async function calculateCreditFromDollarCost(dollarCost: number): Promise<number | null> {
    // 1. Try ranges
    const ranges = await loadCreditRanges();
    for (const range of ranges) {
        if (dollarCost >= range.minDollar && dollarCost < range.maxDollar) {
            return range.creditAmount;
        }
    }

    // 2. Try multipliers (sorted descending by threshold, so first match is highest applicable tier)
    const multipliers = await loadCreditMultipliers();
    for (const tier of multipliers) {
        if (dollarCost >= tier.aboveDollar) {
            return dollarCost * tier.multiplier;
        }
    }

    return null; // no match — caller falls back to old formula
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
    const available = n(c.planCredits) + n(c.topupCredits);

    if (available >= requiredCredits) {
        return { allowed: true, available };
    }

    if (!c.overageEnabled) {
        return { allowed: false, available, reason: "overage_disabled" };
    }

    // With overage: allow if deficit won't exceed overage limit
    const deficit = requiredCredits - available;
    if (deficit <= n(c.overageLimit)) {
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
        const planCr = n(c.planCredits);
        const topupCr = n(c.topupCredits);
        let planDeduct = 0;
        let topupDeduct = 0;
        let remaining = amount;

        // Deduct from planCredits first
        if (planCr > 0) {
            planDeduct = Math.min(planCr, remaining);
            remaining -= planDeduct;
        }

        // Then from topupCredits
        if (remaining > 0 && topupCr > 0) {
            topupDeduct = Math.min(topupCr, remaining);
            remaining -= topupDeduct;
        }

        // Any remaining goes as negative planCredits (overage)
        if (remaining > 0) {
            planDeduct += remaining; // will make planCredits negative
        }

        const newPlan = planCr - planDeduct;
        const newTopup = topupCr - topupDeduct;
        const newBalance = newPlan + newTopup;
        const newTotalConsumed = n(c.totalCreditsConsumed) + amount;

        await db
            .update(credits)
            .set({
                planCredits: String(newPlan),
                topupCredits: String(newTopup),
                balance: String(newBalance),
                totalCreditsConsumed: String(newTotalConsumed),
                updatedAt: new Date(),
            })
            .where(eq(credits.workspaceId, workspaceId));

        // Insert ledger entry
        await db.insert(creditLedger).values({
            workspaceId,
            amount: String(-amount),
            type,
            creditsAfter: String(newBalance),
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
    let newPlan = n(c.planCredits);
    let newTopup = n(c.topupCredits);

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
            planCredits: String(newPlan),
            topupCredits: String(newTopup),
            balance: String(newBalance),
            updatedAt: new Date(),
        })
        .where(eq(credits.workspaceId, workspaceId));

    await db.insert(creditLedger).values({
        workspaceId,
        amount: String(amount),
        type,
        creditsAfter: String(newBalance),
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
        planCredits: n(c.planCredits),
        topupCredits: n(c.topupCredits),
        availableCredits: n(c.planCredits) + n(c.topupCredits),
        overageEnabled: c.overageEnabled,
        overageLimit: n(c.overageLimit),
        totalConsumed: n(c.totalCreditsConsumed),
    };
}

// --- Per-user credit functions ---

export async function checkUserCredits(
    workspaceId: string,
    userId: string,
    requiredCredits: number
): Promise<CheckResult> {
    // 1. Check workspace-level credits first
    const workspaceCheck = await checkCredits(workspaceId, requiredCredits);
    if (!workspaceCheck.allowed) {
        return workspaceCheck;
    }

    // 2. Check if this user is the workspace owner (owners are exempt)
    const workspace = await db
        .select({ ownerId: workspaces.ownerId })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .limit(1);

    if (workspace[0] && workspace[0].ownerId === userId) {
        return { ...workspaceCheck, userLimitExceeded: false };
    }

    // 3. Check per-user credit limit
    const userLimit = await db
        .select()
        .from(userCreditLimits)
        .where(
            and(
                eq(userCreditLimits.workspaceId, workspaceId),
                eq(userCreditLimits.userId, userId)
            )
        )
        .limit(1);

    if (userLimit.length === 0) {
        // No per-user limit configured — allowed
        return { ...workspaceCheck, userLimitExceeded: false };
    }

    const limit = userLimit[0];

    // Lazy period reset: if periodEnd is set and past, reset creditsUsed
    if (limit.periodEnd && new Date() > limit.periodEnd) {
        await db
            .update(userCreditLimits)
            .set({
                creditsUsed: "0",
                periodStart: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(userCreditLimits.id, limit.id));
        limit.creditsUsed = "0";
    }

    const remaining = n(limit.creditLimit) - n(limit.creditsUsed);

    if (remaining < requiredCredits) {
        return {
            allowed: false,
            available: remaining,
            reason: "insufficient_credits",
            userLimitExceeded: true,
        };
    }

    return { ...workspaceCheck, userLimitExceeded: false };
}

export async function deductUserCredits(
    params: DeductParams & { userId?: string }
): Promise<DeductResult> {
    // 1. Deduct from workspace pool (existing logic)
    const result = await deductCredits(params);
    if (!result.success) return result;

    // 2. If userId provided, atomically increment user's creditsUsed
    if (params.userId) {
        try {
            await db
                .update(userCreditLimits)
                .set({
                    creditsUsed: sql`(${userCreditLimits.creditsUsed}::numeric + ${params.amount})`,
                    updatedAt: new Date(),
                })
                .where(
                    and(
                        eq(userCreditLimits.workspaceId, params.workspaceId),
                        eq(userCreditLimits.userId, params.userId)
                    )
                );
        } catch (error) {
            // Non-fatal: workspace credits already deducted, user tracking is best-effort
            logger.warn({ error, userId: params.userId }, "Failed to increment user credit usage");
        }
    }

    return result;
}
