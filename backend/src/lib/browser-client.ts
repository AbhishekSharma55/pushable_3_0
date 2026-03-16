import { AppError } from "./errors.ts";

const BROWSER_SERVICE_URL =
    process.env.BROWSER_SERVICE_URL || "http://localhost:8080";

export const browserClient = {
    async createSession(
        sessionId: string,
        workspaceId: string,
        profileId: string
    ): Promise<string> {
        const res = await fetch(`${BROWSER_SERVICE_URL}/api/browser/sessions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId, workspaceId, profileId }),
            signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) {
            const err = await res.text();
            throw new AppError(
                `Browser service error: ${err}`,
                502,
                "BROWSER_SERVICE_ERROR"
            );
        }
        const data = (await res.json()) as { wsUrl: string };
        return data.wsUrl;
    },

    async closeSession(sessionId: string): Promise<void> {
        const res = await fetch(
            `${BROWSER_SERVICE_URL}/api/browser/sessions/${sessionId}`,
            {
                method: "DELETE",
                signal: AbortSignal.timeout(10_000),
            }
        );
        if (!res.ok && res.status !== 404) {
            throw new AppError(
                "Failed to close browser session",
                502,
                "BROWSER_SERVICE_ERROR"
            );
        }
    },

    async executeAction(
        action: string,
        params: Record<string, unknown>
    ): Promise<{ success: boolean; result: unknown; error: string | null }> {
        const res = await fetch(
            `${BROWSER_SERVICE_URL}/api/browser/${action}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(params),
                signal: AbortSignal.timeout(30_000),
            }
        );
        if (!res.ok) {
            const err = await res.text();
            throw new AppError(
                `Browser action failed: ${err}`,
                502,
                "BROWSER_ACTION_ERROR"
            );
        }
        return res.json() as Promise<{
            success: boolean;
            result: unknown;
            error: string | null;
        }>;
    },
};
