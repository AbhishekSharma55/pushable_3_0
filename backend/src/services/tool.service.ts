import { toolRepository } from "../repositories/tool.repository.ts";
import { NotFoundError } from "../lib/errors.ts";
import { logger } from "../lib/logger.ts";

export const toolService = {
    async createTool(
        data: {
            name: string;
            description?: string;
            type: "mcp" | "function";
            config: Record<string, unknown>;
            isGlobal?: boolean;
        },
        workspaceId: string
    ) {
        return toolRepository.create({ ...data, workspaceId });
    },

    async getTools(workspaceId: string) {
        return toolRepository.findByWorkspace(workspaceId);
    },

    async getTool(id: string) {
        const tool = await toolRepository.findById(id);
        if (!tool) {
            throw new NotFoundError("Tool not found");
        }
        return tool;
    },

    async updateTool(
        id: string,
        data: Partial<{
            name: string;
            description: string;
            type: "mcp" | "function";
            config: Record<string, unknown>;
            isGlobal: boolean;
        }>
    ) {
        const tool = await toolRepository.findById(id);
        if (!tool) {
            throw new NotFoundError("Tool not found");
        }
        return toolRepository.update(id, data);
    },

    async deleteTool(id: string) {
        const tool = await toolRepository.findById(id);
        if (!tool) {
            throw new NotFoundError("Tool not found");
        }
        await toolRepository.delete(id);
    },

    async executeFunctionTool(
        toolId: string,
        input: Record<string, unknown>
    ): Promise<string> {
        const tool = await toolRepository.findById(toolId);
        if (!tool) {
            throw new NotFoundError("Tool not found");
        }

        const config = tool.config as {
            webhookUrl?: string;
            method?: string;
        };
        if (!config.webhookUrl) {
            throw new Error("Tool has no webhook URL configured");
        }

        const method = (config.method || "POST").toUpperCase();

        // Interpolate {{var}} placeholders in the URL
        let resolvedUrl = config.webhookUrl;
        const varPattern = /\{\{(\w+)\}\}/g;
        let match;
        while ((match = varPattern.exec(config.webhookUrl)) !== null) {
            const varName = match[1];
            const value = input[varName];
            if (value !== undefined) {
                resolvedUrl = resolvedUrl.replace(
                    new RegExp(`\\{\\{${varName}\\}\\}`, "g"),
                    encodeURIComponent(String(value))
                );
            }
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30_000);

        try {
            const fetchOptions: RequestInit = {
                method,
                signal: controller.signal,
            };

            if (method === "POST") {
                fetchOptions.headers = { "Content-Type": "application/json" };
                fetchOptions.body = JSON.stringify({ input });
            }

            const response = await fetch(resolvedUrl, fetchOptions);
            const text = await response.text();
            return text;
        } catch (error) {
            logger.error({ error, toolId }, "Function tool execution failed");
            throw new Error(
                `Function tool execution failed: ${error instanceof Error ? error.message : "Unknown error"}`
            );
        } finally {
            clearTimeout(timeout);
        }
    },
};
