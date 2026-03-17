import type { FastifyInstance } from "fastify";
import { eq, desc } from "drizzle-orm";
import { db } from "../db/client.ts";
import { creditLedger } from "../db/schema/index.ts";
import { AppError, UnauthorizedError } from "../lib/errors.ts";
import { getBalance } from "../lib/credit-engine.ts";

export async function creditRoutes(fastify: FastifyInstance) {
    fastify.addHook("onRequest", async (request) => {
        try {
            await request.jwtVerify();
        } catch {
            throw new UnauthorizedError("Invalid or expired token");
        }
    });

    fastify.addHook("preHandler", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        if (!workspaceId) {
            throw new AppError(
                "x-workspace-id header is required",
                400,
                "MISSING_WORKSPACE"
            );
        }
    });

    // GET /credits/balance
    fastify.get("/credits/balance", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const balance = await getBalance(workspaceId);
        return { data: balance };
    });

    // GET /credits/ledger
    fastify.get("/credits/ledger", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { limit: limitStr, type } = request.query as {
            limit?: string;
            type?: string;
        };

        const pageSize = Math.min(Number(limitStr) || 50, 100);

        let query = db
            .select()
            .from(creditLedger)
            .where(eq(creditLedger.workspaceId, workspaceId))
            .orderBy(desc(creditLedger.createdAt))
            .limit(pageSize + 1);

        const results = await query;

        // Filter by type if specified
        let filtered = type
            ? results.filter((r) => r.type === type)
            : results;

        const hasMore = filtered.length > pageSize;
        if (hasMore) filtered = filtered.slice(0, pageSize);

        const nextCursor = hasMore && filtered.length > 0
            ? filtered[filtered.length - 1].id
            : null;

        return {
            data: filtered.map((r) => ({
                id: r.id,
                amount: r.amount,
                type: r.type,
                creditsAfter: r.creditsAfter,
                metadata: r.metadata,
                createdAt: r.createdAt,
            })),
            nextCursor,
        };
    });
}
