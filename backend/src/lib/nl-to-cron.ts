import { CronExpressionParser } from "cron-parser";
import { logger } from "./logger.ts";
import { isClaudeGateway, claudeChat } from "./gateway.ts";

const SYSTEM_PROMPT = `You are a cron expression generator. Convert natural language scheduling descriptions into cron expressions (5-field format: minute hour day-of-month month day-of-week).

Rules:
- Only output valid JSON, nothing else
- Field: cron (string) — the 5-field cron expression
- Field: humanReadable (string) — confirm back in plain English
- Field: confidence (string) — 'high', 'medium', or 'low'

Examples:
'every weekday morning' → {"cron":"0 9 * * 1-5","humanReadable":"Every weekday at 9:00 AM","confidence":"high"}
'twice a week on tuesdays and thursdays at 2pm' → {"cron":"0 14 * * 2,4","humanReadable":"Every Tuesday and Thursday at 2:00 PM","confidence":"high"}
'every hour' → {"cron":"0 * * * *","humanReadable":"Every hour","confidence":"high"}`;

interface NLToCronResult {
    cron: string;
    humanReadable: string;
    confidence: "high" | "medium" | "low";
}

export async function convertNaturalLanguageToCron(
    input: string,
    _timezone: string
): Promise<NLToCronResult> {
    let content: string | undefined;

    if (isClaudeGateway()) {
        // Route through Anthropic API directly
        const raw = await claudeChat(
            [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: input },
            ],
            { model: "claude-haiku-4-5-20251001", temperature: 0, max_tokens: 200 }
        );
        content = raw?.trim();
    } else {
        // Route through OpenRouter (default)
        const apiKey = process.env.OPENROUTER_KEY;
        if (!apiKey) {
            throw new Error("OPENROUTER_KEY is not set");
        }

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
                "HTTP-Referer": "https://pushable.ai",
                "X-Title": "Pushable AI",
            },
            body: JSON.stringify({
                model: "google/gemini-2.0-flash-001",
                messages: [
                    { role: "system", content: SYSTEM_PROMPT },
                    { role: "user", content: input },
                ],
                temperature: 0,
                max_tokens: 200,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            logger.error({ status: response.status, error: errorText }, "NL-to-cron API error");
            throw new Error("Could not understand schedule — try being more specific");
        }

        const data = await response.json() as {
            choices: { message: { content: string } }[];
        };

        content = data.choices?.[0]?.message?.content?.trim();
    }
    if (!content) {
        throw new Error("Could not understand schedule — try being more specific");
    }

    let parsed: NLToCronResult;
    try {
        // Strip markdown code fences if present
        const cleaned = content.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
        parsed = JSON.parse(cleaned);
    } catch {
        logger.error({ content }, "Failed to parse NL-to-cron response");
        throw new Error("Could not understand schedule — try being more specific");
    }

    if (parsed.confidence === "low") {
        throw new Error("Could not understand schedule — try being more specific");
    }

    // Validate cron expression
    try {
        CronExpressionParser.parse(parsed.cron);
    } catch {
        logger.error({ cron: parsed.cron }, "Invalid cron from NL conversion");
        throw new Error("Could not understand schedule — try being more specific");
    }

    return parsed;
}
