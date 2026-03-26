/**
 * Extension Bridge Client — Singleton
 *
 * Provides a shared ExtensionBridge instance and pre-built LangGraph tools
 * for the agent graph to use. Connects to the extension-bridge Docker service.
 *
 * The bridge server runs in its own container (extension-bridge:3001).
 * This client runs inside the backend container and provides the tools.
 */

import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { logger } from "./logger.ts";

// WebSocket client for connecting to the extension-bridge service
import WebSocket from "ws";

interface CommandResult {
    success: boolean;
    data?: unknown;
    error?: string;
    tabId?: number | null;
}

interface PendingCommand {
    resolve: (result: CommandResult) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

class ExtensionBridgeClient {
    private ws: WebSocket | null = null;
    private connected = false;
    private pending = new Map<string, PendingCommand>();
    private reconnectTimer: ReturnType<typeof setInterval> | null = null;
    private url: string;
    private commandTimeout: number;

    constructor(url: string, commandTimeout = 30000) {
        this.url = url;
        this.commandTimeout = commandTimeout;
    }

    /** Connect to the extension-bridge WebSocket server */
    connect(): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

        try {
            this.ws = new WebSocket(this.url);

            this.ws.on("open", () => {
                this.connected = true;
                logger.info("Extension bridge client connected");
                this.stopReconnect();
            });

            this.ws.on("message", (data: Buffer) => {
                try {
                    const msg = JSON.parse(data.toString());
                    if (msg.type === "result" && msg.commandId) {
                        const pending = this.pending.get(msg.commandId);
                        if (pending) {
                            clearTimeout(pending.timer);
                            this.pending.delete(msg.commandId);
                            pending.resolve({
                                success: msg.success,
                                data: msg.data,
                                error: msg.error,
                                tabId: msg.tabId,
                            });
                        }
                    }
                    // Handle ping from server
                    if (msg.type === "ping") {
                        this.send({ type: "pong", ts: Date.now() });
                    }
                } catch (_) {
                    // ignore parse errors
                }
            });

            this.ws.on("close", (code, reason) => {
                this.connected = false;
                logger.warn({ code, reason: reason?.toString() }, "Extension bridge client disconnected or closed");
                this.rejectAllPending("Extension bridge connection closed");
                this.scheduleReconnect();
            });

            this.ws.on("error", (err) => {
                logger.error({ err }, "Extension bridge WebSocket error");
                // error event is followed by close
            });
        } catch (err) {
            logger.warn({ err }, "Failed to connect to extension bridge");
            this.scheduleReconnect();
        }
    }

    /** Check if connected to the bridge server */
    isConnected(): boolean {
        return this.connected && this.ws?.readyState === WebSocket.OPEN;
    }

    /** Check if extension is connected through the bridge */
    async isExtensionConnected(): Promise<boolean> {
        if (!this.isConnected()) return false;
        try {
            // Send a quick status check - the bridge server itself handles this
            // If we can send/receive, the bridge is up. Extension status is
            // checked by trying a command.
            return true;
        } catch {
            return false;
        }
    }

    /** Send a command through the bridge to the extension for a specific workspace */
    async execute(
        action: string,
        params: Record<string, unknown> = {},
        timeout?: number,
        workspaceId?: string
    ): Promise<CommandResult> {
        if (!this.isConnected()) {
            return {
                success: false,
                error:
                    "Extension bridge is not connected. The bridge server may not be running.",
            };
        }

        const commandId = crypto.randomUUID();
        const cmdTimeout = timeout ?? this.commandTimeout;

        return new Promise<CommandResult>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(commandId);
                resolve({
                    success: false,
                    error: `Command '${action}' timed out after ${cmdTimeout}ms. The Chrome extension may not be connected.`,
                });
            }, cmdTimeout);

            this.pending.set(commandId, { resolve, reject, timer });

            const sent = this.send({ commandId, action, workspaceId, ...params });
            if (!sent) {
                clearTimeout(timer);
                this.pending.delete(commandId);
                resolve({
                    success: false,
                    error: "Failed to send command to extension bridge",
                });
            }
        });
    }

    private send(msg: Record<string, unknown>): boolean {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
        try {
            this.ws.send(JSON.stringify(msg));
            return true;
        } catch {
            return false;
        }
    }

    private rejectAllPending(reason: string): void {
        for (const [id, pending] of this.pending) {
            clearTimeout(pending.timer);
            pending.resolve({ success: false, error: reason });
            this.pending.delete(id);
        }
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimer) return;
        this.reconnectTimer = setInterval(() => {
            this.connect();
        }, 5000);
    }

    private stopReconnect(): void {
        if (this.reconnectTimer) {
            clearInterval(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    disconnect(): void {
        this.stopReconnect();
        this.rejectAllPending("Disconnecting");
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.connected = false;
    }
}

// --- Singleton ---

let clientInstance: ExtensionBridgeClient | null = null;

function getExtensionBridgeClient(): ExtensionBridgeClient {
    if (!clientInstance) {
        let url =
            process.env.EXTENSION_BRIDGE_URL || "ws://extension-bridge:3001";
        // Append role=backend so the bridge server knows this is the command sender, not the browser extension
        const separator = url.includes("?") ? "&" : "?";
        const key = process.env.BRIDGE_API_KEY || "";
        url = `${url}${separator}role=backend&key=${key}`;
        clientInstance = new ExtensionBridgeClient(url);
        clientInstance.connect();
    }
    return clientInstance;
}

// --- LangGraph Tools ---

export function buildExtensionBrowserTools(workspaceId?: string): DynamicStructuredTool[] {
    const client = getExtensionBridgeClient();

    /** Execute a command scoped to this workspace */
    const exec = (action: string, params: Record<string, unknown> = {}, timeout?: number) =>
        client.execute(action, params, timeout, workspaceId);

    const safe = async (fn: () => Promise<string>): Promise<string> => {
        try {
            return await fn();
        } catch (err) {
            return err instanceof Error ? err.message : String(err);
        }
    };

    const fmt = (r: CommandResult): string => {
        if (!r.success)
            return `Error: ${r.error || "Unknown error"}`;
        if (r.data === undefined || r.data === null) return "Success";
        // If data has a snapshot field (from getElements/getPageInfo), return it directly
        if (typeof r.data === "object" && r.data !== null && "snapshot" in (r.data as Record<string, unknown>)) {
            return (r.data as Record<string, unknown>).snapshot as string;
        }
        return typeof r.data === "string"
            ? r.data
            : JSON.stringify(r.data);
    };

    return [
        new DynamicStructuredTool({
            name: "ext_browser_check_connection",
            description:
                "Check if the Chrome Browser Agent extension is connected. Call this FIRST before any other ext_browser tool. Returns instructions if not connected.",
            schema: z.object({}),
            func: async () => {
                if (!client.isConnected()) {
                    return (
                        "❌ Extension bridge is not running.\n" +
                        "Start the Docker services with: docker compose up"
                    );
                }
                // Try a quick command to see if extension is actually connected
                const result = await exec("getTabList", {}, 5000);
                if (result.success) {
                    const tabs = Array.isArray(result.data)
                        ? result.data.length
                        : 0;
                    return `✅ Extension is connected. ${tabs} tabs open in Chrome.`;
                }
                return (
                    "❌ Chrome extension is NOT connected to the bridge server.\n\n" +
                    "Please connect:\n" +
                    "1. Open Google Chrome\n" +
                    "2. Click the Browser Agent extension icon\n" +
                    "3. Enter URL: wss://ws.pushable.ai\n" +
                    "4. Click Connect\n" +
                    "5. Wait for Connected status\n\n" +
                    "Then try again."
                );
            },
        }),

        new DynamicStructuredTool({
            name: "ext_browser_navigate",
            description:
                "[CRITICAL: USE THIS TOOL (ext_browser_*) instead of 'browser_*' whenever the user asks to use 'Chrome', 'the extension', or their 'own browser'] Navigate the real Chrome browser to a URL via the extension.",
            schema: z.object({
                url: z.string().describe("The URL to navigate to"),
            }),
            func: async ({ url }: { url: string }) =>
                safe(async () => fmt(await exec("navigate", { url }))),
        }),

        new DynamicStructuredTool({
            name: "ext_browser_click",
            description:
                "Click an element in Chrome. Use [data-psh-id=\"N\"] selectors from get_elements. Works with shadow DOM.",
            schema: z.object({
                selector: z
                    .string()
                    .describe('Element selector, e.g. [data-psh-id="5"]'),
            }),
            func: async ({ selector }: { selector: string }) =>
                safe(async () =>
                    fmt(await exec("click", { selector }))
                ),
        }),

        new DynamicStructuredTool({
            name: "ext_browser_type",
            description:
                "Type text into an input/textarea/contenteditable in Chrome. Use [data-psh-id=\"N\"] selectors.",
            schema: z.object({
                selector: z
                    .string()
                    .describe('Element selector, e.g. [data-psh-id="3"]'),
                text: z.string().describe("Text to type"),
            }),
            func: async ({ selector, text }: { selector: string; text: string }) =>
                safe(async () =>
                    fmt(await exec("type", { selector, text }))
                ),
        }),

        new DynamicStructuredTool({
            name: "ext_browser_type_char",
            description:
                "[CRITICAL: USE THIS TOOL when using the Chrome extension] Type text character by character (human-like) into an input field.",
            schema: z.object({
                selector: z
                    .string()
                    .describe("CSS selector of the input field"),
                text: z.string().describe("Text to type"),
                delay: z
                    .number()
                    .default(80)
                    .describe("Delay between keystrokes in ms"),
            }),
            func: async ({ selector, text, delay }: { selector: string; text: string; delay: number }) =>
                safe(async () =>
                    fmt(
                        await exec("typeChar", {
                            selector,
                            text,
                            delay,
                        })
                    )
                ),
        }),

        new DynamicStructuredTool({
            name: "ext_browser_get_page_info",
            description:
                "Get a compact snapshot of the page: URL, title, visible text, and all interactive elements with their [data-psh-id] selectors. Returns a text snapshot — each line is one element like: [5] button \"Submit\". Use [data-psh-id=\"5\"] as the selector for click/type.",
            schema: z.object({}),
            func: async () =>
                safe(async () =>
                    fmt(await exec("getPageInfo", {}))
                ),
        }),

        new DynamicStructuredTool({
            name: "ext_browser_get_elements",
            description:
                "Get a compact snapshot of all interactive elements on the page with [data-psh-id] selectors. Faster than get_page_info (no page text). Each element shown as: [N] role \"label\". Use [data-psh-id=\"N\"] as selector.",
            schema: z.object({}),
            func: async () =>
                safe(async () =>
                    fmt(await exec("getElements", {}))
                ),
        }),

        new DynamicStructuredTool({
            name: "ext_browser_screenshot",
            description:
                "[CRITICAL: USE THIS TOOL instead of browser_screenshot when using the Chrome extension] Take a screenshot of the current Chrome tab.",
            schema: z.object({}),
            func: async () =>
                safe(async () => {
                    const r = await exec("screenshot", {});
                    if (!r.success) return `Error: ${r.error}`;
                    return "Screenshot captured.";
                }),
        }),

        new DynamicStructuredTool({
            name: "ext_browser_scroll",
            description:
                "Scroll the page in Chrome. Positive y = down, negative = up.",
            schema: z.object({
                y: z
                    .number()
                    .describe("Pixels to scroll (positive=down, negative=up)"),
                selector: z
                    .string()
                    .optional()
                    .describe("CSS selector to scroll within"),
            }),
            func: async ({ y, selector }: { y: number; selector?: string }) =>
                safe(async () =>
                    fmt(await exec("scroll", { y, selector }))
                ),
        }),

        new DynamicStructuredTool({
            name: "ext_browser_wait_for_element",
            description: "Wait for an element to appear in Chrome.",
            schema: z.object({
                selector: z.string().describe("CSS selector to wait for"),
                timeout: z
                    .number()
                    .default(10000)
                    .describe("Timeout in ms"),
            }),
            func: async ({ selector, timeout }: { selector: string; timeout: number }) =>
                safe(async () =>
                    fmt(
                        await exec("waitForElement", {
                            selector,
                            timeout,
                        })
                    )
                ),
        }),

        new DynamicStructuredTool({
            name: "ext_browser_key_press",
            description:
                "Press a keyboard key in Chrome (Enter, Tab, Escape, etc.).",
            schema: z.object({
                key: z.string().describe("Key to press"),
            }),
            func: async ({ key }: { key: string }) =>
                safe(async () =>
                    fmt(await exec("keyPress", { key }))
                ),
        }),

        new DynamicStructuredTool({
            name: "ext_browser_evaluate",
            description: "Execute JavaScript in the Chrome page context.",
            schema: z.object({
                script: z.string().describe("JavaScript code to execute"),
            }),
            func: async ({ script }: { script: string }) =>
                safe(async () =>
                    fmt(await exec("evaluate", { script }))
                ),
        }),

        new DynamicStructuredTool({
            name: "ext_browser_new_tab",
            description:
                "[CRITICAL: USE THIS TOOL instead of browser_navigate when the user asks to open a new tab in the Chrome extension] Open a new tab in Chrome.",
            schema: z.object({
                url: z.string().optional().describe("URL to open"),
            }),
            func: async ({ url }: { url?: string }) =>
                safe(async () =>
                    fmt(await exec("newTab", { url }))
                ),
        }),

        new DynamicStructuredTool({
            name: "ext_browser_close_tab",
            description: "Close a tab in Chrome by ID.",
            schema: z.object({
                tabId: z.number().describe("Tab ID to close"),
            }),
            func: async ({ tabId }: { tabId: number }) =>
                safe(async () =>
                    fmt(await exec("closeTab", { tabId }))
                ),
        }),

        new DynamicStructuredTool({
            name: "ext_browser_get_tabs",
            description: "List all open tabs in Chrome.",
            schema: z.object({}),
            func: async () =>
                safe(async () =>
                    fmt(await exec("getTabList", {}))
                ),
        }),

        new DynamicStructuredTool({
            name: "ext_browser_switch_tab",
            description: "Switch to a tab in Chrome by ID.",
            schema: z.object({
                tabId: z.number().describe("Tab ID to switch to"),
            }),
            func: async ({ tabId }: { tabId: number }) =>
                safe(async () =>
                    fmt(await exec("switchTab", { tabId }))
                ),
        }),

        new DynamicStructuredTool({
            name: "ext_browser_go_back",
            description: "Navigate back in Chrome.",
            schema: z.object({}),
            func: async () =>
                safe(async () =>
                    fmt(await exec("goBack", {}))
                ),
        }),

        new DynamicStructuredTool({
            name: "ext_browser_reload",
            description: "Reload the current Chrome page.",
            schema: z.object({}),
            func: async () =>
                safe(async () =>
                    fmt(await exec("reload", {}))
                ),
        }),

        new DynamicStructuredTool({
            name: "ext_browser_select",
            description: "Select a dropdown option in Chrome.",
            schema: z.object({
                selector: z
                    .string()
                    .describe("CSS selector of the select element"),
                value: z.string().describe("Option value to select"),
            }),
            func: async ({ selector, value }: { selector: string; value: string }) =>
                safe(async () =>
                    fmt(await exec("select", { selector, value }))
                ),
        }),

        new DynamicStructuredTool({
            name: "ext_browser_hover",
            description: "Hover over an element in Chrome.",
            schema: z.object({
                selector: z
                    .string()
                    .describe("CSS selector of element to hover"),
            }),
            func: async ({ selector }: { selector: string }) =>
                safe(async () =>
                    fmt(await exec("hover", { selector }))
                ),
        }),
    ];
}

// Ensure it starts connecting in the background on load
getExtensionBridgeClient();
