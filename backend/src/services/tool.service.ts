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

        const config = tool.config as { webhookUrl?: string };
        if (!config.webhookUrl) {
            throw new Error("Tool has no webhook URL configured");
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30_000);

        try {
            const response = await fetch(config.webhookUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ input }),
                signal: controller.signal,
            });

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
