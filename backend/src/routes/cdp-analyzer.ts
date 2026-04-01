/**
 * CDP Analyzer Proxy Routes
 *
 * Proxies requests from the extension to the cdp-analyzer Python service.
 * The extension sends raw CDP snapshot data, the backend forwards it to
 * the analyzer for processing, and returns the results.
 *
 * This avoids exposing the analyzer port directly — everything goes through
 * the backend API which the extension already connects to.
 */

import type { FastifyInstance } from "fastify";
import { logger } from "../lib/logger.ts";

const CDP_ANALYZER_URL = process.env.CDP_ANALYZER_URL || "http://localhost:5050";

export async function cdpAnalyzerRoutes(app: FastifyInstance) {
    // Health check
    app.get("/cdp-analyzer/health", async (_req, reply) => {
        try {
            const resp = await fetch(`${CDP_ANALYZER_URL}/health`);
            const data = await resp.json();
            return reply.send(data);
        } catch (error) {
            return reply.status(503).send({ status: "unavailable", error: String(error) });
        }
    });

    // Process raw CDP snapshot data → return interactive elements
    app.post("/cdp-analyzer/process", { bodyLimit: 50 * 1024 * 1024 }, async (req, reply) => {
        try {
            const resp = await fetch(`${CDP_ANALYZER_URL}/process`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(req.body),
            });
            if (!resp.ok) {
                const err = await resp.text();
                return reply.status(resp.status).send({ error: err });
            }
            const data = await resp.json();
            return reply.send(data);
        } catch (error) {
            logger.error({ error }, "CDP analyzer /process proxy failed");
            return reply.status(502).send({ error: "CDP analyzer unavailable" });
        }
    });

    // Find overflow menu button near text
    app.post("/cdp-analyzer/find-overflow", { bodyLimit: 50 * 1024 * 1024 }, async (req, reply) => {
        try {
            const url = new URL(`${CDP_ANALYZER_URL}/find-overflow`);
            const query = req.query as Record<string, string>;
            if (query.near_text) url.searchParams.set("near_text", query.near_text);
            if (query.menu_action) url.searchParams.set("menu_action", query.menu_action);

            const resp = await fetch(url.toString(), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(req.body),
            });
            if (!resp.ok) {
                const err = await resp.text();
                return reply.status(resp.status).send({ error: err });
            }
            const data = await resp.json();
            return reply.send(data);
        } catch (error) {
            logger.error({ error }, "CDP analyzer /find-overflow proxy failed");
            return reply.status(502).send({ error: "CDP analyzer unavailable" });
        }
    });
}
