import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { browserRepository } from "../repositories/browser.repository.ts";
import { browserClient } from "../lib/browser-client.ts";
import { browserService } from "../services/browser.service.ts";
import { logger } from "../lib/logger.ts";

export async function buildBrowserTools(
    agentId: string,
    workspaceId: string
): Promise<DynamicStructuredTool[]> {
    // Check if agent has a browser profile assigned
    const profile = await browserRepository.findProfileByAgentId(
        agentId,
        workspaceId
    );
    if (!profile || profile.status !== "active") {
        return [];
    }

    // Check for existing active session, verify it's alive, or create new one
    let activeSession = await browserRepository.findActiveSessionByProfileId(
        profile.id
    );
    let sessionId = "";

    if (activeSession) {
        // Verify the session is actually alive in browser-service
        try {
            await browserClient.executeAction("get_url", {
                sessionId: activeSession.id,
            });
            sessionId = activeSession.id;
        } catch {
            // Session is stale in DB, mark it closed and create a new one
            logger.info(
                { sessionId: activeSession.id },
                "Stale browser session found, closing and creating new one"
            );
            await browserRepository.updateSessionStatus(
                activeSession.id,
                "closed",
                new Date()
            );
            activeSession = null;
        }
    }

    if (!activeSession) {
        try {
            const result = await browserService.startSession(
                profile.id,
                workspaceId,
                agentId
            );
            sessionId = result.sessionId;
        } catch (error) {
            logger.error(
                { error, agentId, profileId: profile.id },
                "Failed to start browser session for agent"
            );
            return [];
        }
    }

    const executeAction = async (
        action: string,
        params: Record<string, unknown>
    ): Promise<string> => {
        try {
            const result = await browserClient.executeAction(action, {
                sessionId,
                ...params,
            });
            if (result.error) return `Error: ${result.error}`;
            return typeof result.result === "string"
                ? result.result
                : JSON.stringify(result.result);
        } catch (error) {
            const msg =
                error instanceof Error ? error.message : "Unknown error";
            logger.warn({ error, action, sessionId }, "Browser action failed");
            return `Browser action failed: ${msg}`;
        }
    };

    const tools: DynamicStructuredTool[] = [
        new DynamicStructuredTool({
            name: "browser_navigate",
            description:
                "Navigate the browser to a URL. CAPTCHAs and Cloudflare challenges are solved automatically — this tool waits up to 15 seconds for them to resolve before returning. Do NOT assume navigation failed due to CAPTCHA; just read the returned title and URL to confirm the page loaded.",
            schema: z.object({
                url: z.string().describe("The URL to navigate to"),
            }),
            func: async ({ url }) => executeAction("navigate", { url }),
        }),
        new DynamicStructuredTool({
            name: "browser_click",
            description:
                "Click an element on the page by CSS selector or visible text.",
            schema: z.object({
                selector: z
                    .string()
                    .optional()
                    .describe("CSS selector of element to click"),
                text: z
                    .string()
                    .optional()
                    .describe("Visible text of element to click"),
            }),
            func: async ({ selector, text }) =>
                executeAction("click", { selector, text }),
        }),
        new DynamicStructuredTool({
            name: "browser_type",
            description:
                "Type text into an input field identified by CSS selector.",
            schema: z.object({
                selector: z
                    .string()
                    .describe("CSS selector of the input field"),
                text: z.string().describe("Text to type"),
                clearFirst: z
                    .boolean()
                    .default(false)
                    .describe("Clear the field before typing"),
            }),
            func: async ({ selector, text, clearFirst }) =>
                executeAction("type", { selector, text, clearFirst }),
        }),
        new DynamicStructuredTool({
            name: "browser_get_text",
            description:
                "Extract visible text content from the page or a specific element. Use this after navigating to read page content. If the page shows a CAPTCHA or challenge, wait a few seconds and try again — it will be solved automatically.",
            schema: z.object({
                selector: z
                    .string()
                    .default("body")
                    .describe("CSS selector (default: body)"),
            }),
            func: async ({ selector }) =>
                executeAction("get_text", { selector }),
        }),
        new DynamicStructuredTool({
            name: "browser_screenshot",
            description:
                "Take a screenshot of the current page. The screenshot is visible in the live browser preview.",
            schema: z.object({}),
            func: async () => executeAction("screenshot", {}),
        }),
        new DynamicStructuredTool({
            name: "browser_scroll",
            description: "Scroll the page in a direction.",
            schema: z.object({
                direction: z
                    .enum(["up", "down", "left", "right"])
                    .describe("Scroll direction"),
                amount: z
                    .number()
                    .default(500)
                    .describe("Pixels to scroll"),
            }),
            func: async ({ direction, amount }) =>
                executeAction("scroll", { direction, amount }),
        }),
        new DynamicStructuredTool({
            name: "browser_wait_for",
            description: "Wait for an element to appear on the page.",
            schema: z.object({
                selector: z.string().describe("CSS selector to wait for"),
                timeout: z
                    .number()
                    .default(10000)
                    .describe("Timeout in milliseconds"),
            }),
            func: async ({ selector, timeout }) =>
                executeAction("wait_for", { selector, timeout }),
        }),
        new DynamicStructuredTool({
            name: "browser_execute_js",
            description:
                "Execute JavaScript code in the browser page context.",
            schema: z.object({
                script: z.string().describe("JavaScript code to execute"),
            }),
            func: async ({ script }) =>
                executeAction("execute_js", { script }),
        }),
        new DynamicStructuredTool({
            name: "browser_get_url",
            description: "Get the current page URL and title.",
            schema: z.object({}),
            func: async () => executeAction("get_url", {}),
        }),
        new DynamicStructuredTool({
            name: "browser_go_back",
            description: "Navigate back to the previous page.",
            schema: z.object({}),
            func: async () => executeAction("go_back", {}),
        }),
        new DynamicStructuredTool({
            name: "browser_keyboard",
            description: "Press a keyboard key (e.g. Enter, Tab, Escape).",
            schema: z.object({
                key: z
                    .string()
                    .describe(
                        "Key to press (e.g. 'Enter', 'Tab', 'Escape')"
                    ),
            }),
            func: async ({ key }) => executeAction("keyboard", { key }),
        }),
        new DynamicStructuredTool({
            name: "browser_solve_captcha",
            description:
                "Detect and solve any CAPTCHA on the current page (reCAPTCHA v2/v3, hCaptcha, Cloudflare Turnstile). Call this if you are blocked by a CAPTCHA.",
            schema: z.object({}),
            func: async () => {
                const result = await executeAction("solve_captcha", {});
                try {
                    const parsed = JSON.parse(result);
                    if (parsed.method === "none_needed") {
                        return "No CAPTCHA detected on the current page.";
                    }
                    if (parsed.solved) {
                        return `CAPTCHA solved successfully using ${parsed.method}.`;
                    }
                    return `CAPTCHA solve failed (${parsed.method}): ${parsed.error || "unknown error"}`;
                } catch {
                    return result;
                }
            },
        }),
    ];

    return tools;
}
