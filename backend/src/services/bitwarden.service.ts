import { execFile } from "child_process";
import { promisify } from "util";
import { logger } from "../lib/logger.ts";

const execFileAsync = promisify(execFile);
const BW_CLI = "bw";
const CLI_TIMEOUT = 60_000; // 60 seconds

interface VaultItem {
    username: string;
    password: string;
    uri: string;
    name: string;
}

/**
 * Filter out Node.js deprecation warnings and other noise from stderr.
 * Returns only the meaningful error lines.
 */
function cleanStderr(stderr: string): string {
    if (!stderr) return "";
    return stderr
        .split("\n")
        .filter((line) => {
            const trimmed = line.trim();
            if (!trimmed) return false;
            // Filter out Node.js deprecation warnings
            if (trimmed.includes("[DEP0")) return false;
            if (trimmed.includes("DeprecationWarning")) return false;
            if (trimmed.includes("--trace-deprecation")) return false;
            // Filter out first-run setup messages
            if (trimmed.includes("creating it instead")) return false;
            if (trimmed.includes("Could not find dir")) return false;
            if (trimmed.includes("Could not find data file")) return false;
            return true;
        })
        .join("\n")
        .trim();
}

/**
 * Execute a Bitwarden CLI command and return stdout.
 * Deprecation warnings and setup messages in stderr are filtered out.
 */
async function bwExec(
    args: string[],
    env?: Record<string, string>
): Promise<string> {
    try {
        const { stdout, stderr } = await execFileAsync(BW_CLI, args, {
            timeout: CLI_TIMEOUT,
            env: { ...process.env, ...env, NODE_NO_WARNINGS: "1" },
            maxBuffer: 10 * 1024 * 1024,
        });
        // Log cleaned stderr as warnings (not errors) if present
        const cleanedErr = cleanStderr(stderr);
        if (cleanedErr) {
            logger.warn(
                { stderr: cleanedErr, command: args[0] },
                "Bitwarden CLI stderr output"
            );
        }
        return stdout.trim();
    } catch (error: unknown) {
        const err = error as {
            stderr?: string;
            stdout?: string;
            message?: string;
        };
        const rawStderr = err.stderr || "";
        const cleanedErr = cleanStderr(rawStderr);
        // If the cleaned stderr is empty, the original error was just deprecation warnings
        // — try to get the real error from the error message
        const message =
            cleanedErr ||
            (err.message ? cleanStderr(err.message) : "") ||
            "Unknown Bitwarden CLI error";
        logger.error(
            { error: message, args: args[0] },
            "Bitwarden CLI error"
        );
        throw new Error(message);
    }
}

/**
 * Logout any existing session (ignore errors — "not logged in" is expected).
 */
async function ensureLoggedOut(): Promise<void> {
    try {
        await bwExec(["logout"]);
    } catch {
        // Already logged out or no session — this is fine
    }
}

/**
 * Login with API key and unlock with master password.
 * Returns the session key needed for subsequent operations.
 *
 * The Bitwarden CLI expects personal API key credentials:
 * - BW_CLIENTID: format "user.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
 * - BW_CLIENTSECRET: the client secret string
 *
 * After login, the vault must be unlocked with the master password.
 */
async function loginAndUnlock(
    clientId: string,
    clientSecret: string,
    masterPassword: string
): Promise<string> {
    await ensureLoggedOut();

    // Login using API key — credentials passed via environment variables
    try {
        await bwExec(["login", "--apikey"], {
            BW_CLIENTID: clientId,
            BW_CLIENTSECRET: clientSecret,
        });
    } catch (error) {
        const msg =
            error instanceof Error ? error.message : "Login failed";
        // Provide clearer error messages for common failures
        if (
            msg.toLowerCase().includes("invalid") ||
            msg.toLowerCase().includes("api key")
        ) {
            throw new Error(
                "Invalid API credentials. Make sure you're using your Personal API Key " +
                    "(client_id should start with 'user.'). " +
                    "Get it from vault.bitwarden.com → Settings → Security → Keys → View API Key."
            );
        }
        throw new Error(`Bitwarden login failed: ${msg}`);
    }

    // Unlock the vault with master password to get the session key
    let sessionKey: string;
    try {
        sessionKey = await bwExec(["unlock", masterPassword, "--raw"]);
    } catch (error) {
        const msg =
            error instanceof Error ? error.message : "Unlock failed";
        await ensureLoggedOut();
        if (
            msg.toLowerCase().includes("invalid") ||
            msg.toLowerCase().includes("password")
        ) {
            throw new Error(
                "Invalid master password. Please check and try again."
            );
        }
        throw new Error(`Bitwarden vault unlock failed: ${msg}`);
    }

    if (!sessionKey) {
        await ensureLoggedOut();
        throw new Error(
            "Failed to obtain Bitwarden session key after unlock"
        );
    }

    return sessionKey;
}

/**
 * Test connection by logging in and unlocking, then logging out.
 */
export async function testConnection(
    clientId: string,
    clientSecret: string,
    masterPassword: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const sessionKey = await loginAndUnlock(
            clientId,
            clientSecret,
            masterPassword
        );

        // Verify by syncing the vault
        await bwExec(["sync", "--session", sessionKey]);

        // Clean up
        await bwExec(["logout"]);

        return { success: true };
    } catch (error) {
        const message =
            error instanceof Error ? error.message : "Unknown error";
        await ensureLoggedOut();
        return { success: false, error: message };
    }
}

/**
 * Fetch a credential from the Bitwarden vault by item name/search term.
 */
export async function getCredential(
    clientId: string,
    clientSecret: string,
    masterPassword: string,
    searchTerm: string
): Promise<VaultItem | null> {
    let sessionKey: string;

    try {
        sessionKey = await loginAndUnlock(
            clientId,
            clientSecret,
            masterPassword
        );
    } catch (error) {
        logger.error({ error }, "Failed to login to Bitwarden");
        throw error;
    }

    try {
        // Sync vault first to get latest items
        await bwExec(["sync", "--session", sessionKey]);

        // Search for items
        const rawOutput = await bwExec([
            "list",
            "items",
            "--search",
            searchTerm,
            "--session",
            sessionKey,
        ]);

        const items = JSON.parse(rawOutput);

        if (!Array.isArray(items) || items.length === 0) {
            await bwExec(["logout"]);
            return null;
        }

        // Filter to login items (type 1) and find best match
        const loginItems = items.filter(
            (item: Record<string, unknown>) => item.type === 1
        );

        if (loginItems.length === 0) {
            await bwExec(["logout"]);
            return null;
        }

        // Prefer exact name match, otherwise use first result
        const exactMatch = loginItems.find(
            (item: Record<string, unknown>) =>
                (item.name as string).toLowerCase() ===
                searchTerm.toLowerCase()
        );
        const bestMatch = exactMatch || loginItems[0];

        const login = bestMatch.login as {
            username?: string;
            password?: string;
            uris?: Array<{ uri?: string }>;
        };

        const result: VaultItem = {
            name: bestMatch.name as string,
            username: login?.username || "",
            password: login?.password || "",
            uri: login?.uris?.[0]?.uri || "",
        };

        // Clean up
        await bwExec(["logout"]);

        return result;
    } catch (error) {
        await ensureLoggedOut();
        logger.error(
            { error, searchTerm },
            "Failed to fetch credential from Bitwarden"
        );
        throw error;
    }
}
