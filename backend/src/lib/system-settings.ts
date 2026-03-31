import postgres from "postgres";
import { logger } from "./logger.ts";

const connectionString = process.env.DATABASE_URL!;
const sql = postgres(connectionString);

const DEFAULT_BROWSER_AGENT_MODEL = "google/openai/gpt-4o-mini";

export interface BrowserAgentSettings {
    model: string;
    prompt: string;
}

/**
 * Read browser agent settings from the system_settings table
 * (written by the admin panel).
 */
export async function getBrowserAgentSettings(): Promise<BrowserAgentSettings> {
    try {
        const rows = await sql`
            SELECT key, value FROM system_settings
            WHERE key IN ('browser_agent_model', 'browser_agent_prompt')
        `;
        const map: Record<string, string> = {};
        for (const r of rows) map[r.key] = r.value;
        return {
            model: map.browser_agent_model || DEFAULT_BROWSER_AGENT_MODEL,
            prompt: map.browser_agent_prompt || "",
        };
    } catch (error) {
        logger.warn({ error }, "Failed to read browser agent settings, using defaults");
        return { model: DEFAULT_BROWSER_AGENT_MODEL, prompt: "" };
    }
}
