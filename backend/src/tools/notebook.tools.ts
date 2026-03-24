import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import type { BaseStore } from "@langchain/langgraph";
import { logger } from "../lib/logger.ts";

/**
 * Notebook tools give the agent a persistent scratchpad that survives
 * across sessions and context compression.
 *
 * Unlike long-term memory (which stores facts *about the user*), the
 * notebook stores *working references* the agent discovers during tasks:
 * Google Sheet IDs, API endpoints, resource handles, intermediate results, etc.
 *
 * Backed by LangGraph Store (PostgresStore) with namespace:
 *   [workspaceId, agentId, userId, "notebook"]
 */

export interface NotebookEntry {
    key: string;
    value: string;
    description?: string;
    updatedAt: string;
}

export function buildNotebookTools(opts: {
    store: BaseStore;
    workspaceId: string;
    agentId: string;
    userId: string;
}): DynamicStructuredTool[] {
    const { store, workspaceId, agentId, userId } = opts;
    const namespace = [workspaceId, agentId, userId, "notebook"];

    const writeNotebook = new DynamicStructuredTool({
        name: "write_notebook",
        description:
            "Save a working reference to your persistent notebook. Use this to remember resource IDs, " +
            "sheet names, API endpoints, URLs, configuration values, or any operational context you'll need " +
            "across sessions. Unlike save_memory (which stores facts about the user), the notebook stores " +
            "things YOU discovered or need for YOUR ongoing work.\n\n" +
            "Examples:\n" +
            '- key: "leads_sheet_id", value: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"\n' +
            '- key: "leads_sheet_name", value: "Q1 2026 Leads"\n' +
            '- key: "last_processed_row", value: "47"\n' +
            '- key: "crm_api_base_url", value: "https://api.example.com/v2"',
        schema: z.object({
            key: z
                .string()
                .describe(
                    "A short, descriptive key for this entry (e.g. 'leads_sheet_id', 'email_template_doc'). " +
                    "Use snake_case. If the key already exists, the value will be updated."
                ),
            value: z
                .string()
                .describe(
                    "The value to store (e.g. a sheet ID, URL, name, number, or any text reference)"
                ),
            description: z
                .string()
                .optional()
                .describe(
                    "Optional brief description of what this entry is for (e.g. 'Google Sheet with Q1 lead data')"
                ),
        }),
        func: async ({ key, value, description }) => {
            try {
                await store.put(namespace, key, {
                    value,
                    description: description || "",
                    updatedAt: new Date().toISOString(),
                });
                const desc = description ? ` (${description})` : "";
                return `Notebook updated: ${key} = "${value}"${desc}`;
            } catch (error) {
                logger.error({ error, key }, "Failed to write notebook entry");
                return `Failed to save notebook entry "${key}".`;
            }
        },
    });

    const readNotebook = new DynamicStructuredTool({
        name: "read_notebook",
        description:
            "Read a specific entry from your notebook by key. Use this to look up a resource ID, " +
            "URL, or other reference you previously saved.",
        schema: z.object({
            key: z
                .string()
                .describe("The key to look up (e.g. 'leads_sheet_id')"),
        }),
        func: async ({ key }) => {
            try {
                const item = await store.get(namespace, key);
                if (!item || !item.value) {
                    return `No notebook entry found for key "${key}". Use list_notebook to see all entries.`;
                }
                const data = item.value as { value: string; description?: string; updatedAt?: string };
                const desc = data.description ? ` — ${data.description}` : "";
                return `${key} = "${data.value}"${desc}`;
            } catch (error) {
                logger.error({ error, key }, "Failed to read notebook entry");
                return `Failed to read notebook entry "${key}".`;
            }
        },
    });

    const listNotebook = new DynamicStructuredTool({
        name: "list_notebook",
        description:
            "List all entries in your notebook. Shows all saved references, IDs, and working context.",
        schema: z.object({}),
        func: async () => {
            try {
                const items = await store.search(namespace, { limit: 100 });
                if (!items || items.length === 0) {
                    return "Notebook is empty. Use write_notebook to save working references.";
                }
                const lines = items.map((item) => {
                    const data = item.value as { value: string; description?: string; updatedAt?: string };
                    const desc = data.description ? ` — ${data.description}` : "";
                    return `- ${item.key}: "${data.value}"${desc}`;
                });
                return `Notebook entries (${items.length}):\n${lines.join("\n")}`;
            } catch (error) {
                logger.error({ error }, "Failed to list notebook entries");
                return "Failed to list notebook entries.";
            }
        },
    });

    const deleteNotebookEntry = new DynamicStructuredTool({
        name: "delete_notebook_entry",
        description:
            "Remove an entry from your notebook. Use this when a reference is no longer needed " +
            "(e.g. a sheet was deleted, a project ended).",
        schema: z.object({
            key: z
                .string()
                .describe("The key to delete (e.g. 'old_sheet_id')"),
        }),
        func: async ({ key }) => {
            try {
                await store.delete(namespace, key);
                return `Notebook entry "${key}" deleted.`;
            } catch (error) {
                logger.error({ error, key }, "Failed to delete notebook entry");
                return `Failed to delete notebook entry "${key}".`;
            }
        },
    });

    return [writeNotebook, readNotebook, listNotebook, deleteNotebookEntry];
}

/**
 * Load all notebook entries for injection into the system prompt.
 * Returns formatted string or empty string if no entries.
 */
export async function loadNotebookEntries(opts: {
    store: BaseStore;
    workspaceId: string;
    agentId: string;
    userId: string;
}): Promise<string> {
    const { store, workspaceId, agentId, userId } = opts;
    const namespace = [workspaceId, agentId, userId, "notebook"];

    try {
        const items = await store.search(namespace, { limit: 100 });
        if (!items || items.length === 0) return "";

        const lines = items.map((item) => {
            const data = item.value as { value: string; description?: string };
            const desc = data.description ? ` — ${data.description}` : "";
            return `- **${item.key}**: ${data.value}${desc}`;
        });

        return (
            `## Your Notebook (Working Context)\n` +
            `⚠️ These are references you saved during previous work. Use them directly — do NOT search for these again.\n\n` +
            lines.join("\n")
        );
    } catch (error) {
        logger.warn({ error }, "Failed to load notebook entries");
        return "";
    }
}
