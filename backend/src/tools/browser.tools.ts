import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { browserRepository } from "../repositories/browser.repository.ts";
import { browserClient } from "../lib/browser-client.ts";
import { browserService } from "../services/browser.service.ts";
import { agentRepository } from "../repositories/agent.repository.ts";
import { logger } from "../lib/logger.ts";

/**
 * Result of building browser tools: the tools themselves plus a
 * getPageState helper the browser agent uses to auto-inject page
 * context before each LLM turn.
 */
export interface BrowserToolsResult {
    tools: DynamicStructuredTool[];
    /** Fetch current interactive elements + page state as text for LLM */
    getPageState: () => Promise<string>;
}

export async function buildBrowserTools(
    agentId: string,
    workspaceId: string,
    chatSessionId?: string
): Promise<BrowserToolsResult | null> {
    // --- Auto-create browser profile if none exists ---
    const agent = await agentRepository.findById(agentId, workspaceId);

    let profile = await browserRepository.findProfileByAgentId(
        agentId,
        workspaceId
    );

    // Every agent gets browser access — auto-create profile if missing
    if (!profile) {
        try {
            profile = await browserService.createProfile(
                { name: `${agent?.name ?? "Agent"} Browser`, assignedAgentId: agentId, os: "windows" },
                workspaceId
            );
            logger.info(
                { agentId, profileId: profile.id },
                "Auto-created browser profile for agent"
            );
        } catch (error) {
            logger.error({ error, agentId }, "Failed to auto-create browser profile");
            return null;
        }
    }

    if (profile.status !== "active") {
        return null;
    }

    // --- Session management: one active session per profile ---
    let sessionId = "";

    // Check for any existing active session on this profile
    const existingSession = await browserRepository.findActiveSessionByProfileId(
        profile.id
    );

    if (existingSession) {
        // Same chat session? Try to reuse it
        if (chatSessionId && existingSession.taskId === chatSessionId) {
            try {
                await browserClient.executeAction("get_url", {
                    sessionId: existingSession.id,
                });
                // Session is alive and for this chat — reuse it
                sessionId = existingSession.id;
                logger.info(
                    { sessionId, chatSessionId },
                    "Reusing existing browser session for chat"
                );
            } catch {
                // Session is stale, mark closed — will create new below
                await browserRepository.updateSessionStatus(
                    existingSession.id, "closed", new Date()
                );
            }
        } else {
            // Different chat session or no chatSessionId — close old session
            logger.info(
                { oldSessionId: existingSession.id, chatSessionId },
                "Closing old browser session for new chat"
            );
            try {
                await browserClient.closeSession(existingSession.id);
            } catch {
                // Ignore close errors
            }
            await browserRepository.updateSessionStatus(
                existingSession.id, "closed", new Date()
            );
        }
    }

    // Create new session if we don't have one
    if (!sessionId) {
        try {
            const proxyId = agent?.browserProxyId;
            const result = await browserService.startSession(
                profile.id,
                workspaceId,
                agentId,
                proxyId ?? undefined,
                chatSessionId
            );
            sessionId = result.sessionId;
            logger.info(
                { sessionId, chatSessionId },
                "Created new browser session for chat"
            );
        } catch (error) {
            logger.error(
                { error, agentId, profileId: profile.id },
                "Failed to start browser session for agent"
            );
            return null;
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

    // ── Page state helper (used by browser agent for auto-injection) ──

    const getPageState = async (): Promise<string> => {
        return executeAction("get_interactive_elements", {});
    };

    // ── Tools ─────────────────────────────────────────────────────────

    const tools: DynamicStructuredTool[] = [
        // --- Primary: Index-based tools (DOM-aware) ---

        new DynamicStructuredTool({
            name: "click_element",
            description:
                "Click an interactive element by its index number from the page state. " +
                "This is the primary way to click — use the element index shown in the page state (e.g., [3]).",
            schema: z.object({
                index: z
                    .number()
                    .describe(
                        "The element index number from the page state list"
                    ),
            }),
            func: async ({ index }) =>
                executeAction("click_element", { index }),
        }),

        new DynamicStructuredTool({
            name: "type_element",
            description:
                "Type text into an input/textarea element by its index number from the page state. " +
                "This is the primary way to type — use the element index shown in the page state.",
            schema: z.object({
                index: z
                    .number()
                    .describe(
                        "The element index number from the page state list"
                    ),
                text: z.string().describe("Text to type into the element"),
                clearFirst: z
                    .boolean()
                    .default(false)
                    .describe(
                        "Clear existing content before typing (use for replacing text)"
                    ),
            }),
            func: async ({ index, text, clearFirst }) =>
                executeAction("type_element", { index, text, clearFirst }),
        }),

        // --- Navigation & page control ---

        new DynamicStructuredTool({
            name: "browser_navigate",
            description:
                "Navigate the browser to a URL. CAPTCHAs and Cloudflare challenges are solved automatically.",
            schema: z.object({
                url: z.string().describe("The URL to navigate to"),
            }),
            func: async ({ url }) => executeAction("navigate", { url }),
        }),

        new DynamicStructuredTool({
            name: "browser_scroll",
            description:
                "Scroll the page to reveal more content. Check the page state for scroll info (pages above/below).",
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
            name: "browser_go_back",
            description: "Navigate back to the previous page.",
            schema: z.object({}),
            func: async () => executeAction("go_back", {}),
        }),

        new DynamicStructuredTool({
            name: "browser_keyboard",
            description:
                "Press a keyboard key (e.g. Enter, Tab, Escape). Use after typing to submit, or to close dialogs.",
            schema: z.object({
                key: z
                    .string()
                    .describe(
                        "Key to press (e.g. 'Enter', 'Tab', 'Escape')"
                    ),
            }),
            func: async ({ key }) => executeAction("keyboard", { key }),
        }),

        // --- Reading & inspection ---

        new DynamicStructuredTool({
            name: "browser_get_text",
            description:
                "Extract visible text content from the page or a specific element. " +
                "Use for reading long-form content that isn't in the page state summary.",
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
            name: "browser_execute_js",
            description:
                "Execute JavaScript code in the browser page context. Use as a last resort for complex interactions.",
            schema: z.object({
                script: z.string().describe("JavaScript code to execute"),
            }),
            func: async ({ script }) =>
                executeAction("execute_js", { script }),
        }),

        // --- Fallback: CSS selector tools (for edge cases) ---

        new DynamicStructuredTool({
            name: "browser_click",
            description:
                "Fallback: Click an element by CSS selector or visible text. Prefer click_element(index) instead.",
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
                "Fallback: Type text into an input by CSS selector. Prefer type_element(index) instead.",
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
            name: "browser_solve_captcha",
            description:
                "Detect and solve any CAPTCHA on the current page.",
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

    return { tools, getPageState };
}
