import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "fs";
import { hostname } from "os";
import crypto from "crypto";
import { logger } from "../lib/logger.ts";
import { encrypt, decrypt } from "../lib/encryption.ts";
import { vaultRepository } from "../repositories/vault.repository.ts";

const execFileAsync = promisify(execFile);

// Each workspace gets its own CLI data dir to avoid multi-user conflicts
const BW_DATA_ROOT = process.env.BW_DATA_ROOT || "/tmp/bw-sessions";

// Trusted device ID — reuse across all workspace dirs so Bitwarden sees one device
const BW_DEVICE_ID = process.env.BW_DEVICE_ID || generateFallbackDeviceId();

function generateFallbackDeviceId(): string {
    const hash = crypto.createHash("sha256").update(`pushable:${hostname()}`).digest("hex");
    return [hash.slice(0, 8), hash.slice(8, 12), hash.slice(12, 16), hash.slice(16, 20), hash.slice(20, 32)].join("-");
}

function getDataDir(workspaceId: string): string {
    return `${BW_DATA_ROOT}/${workspaceId}`;
}

function bwEnv(workspaceId: string): Record<string, string> {
    return {
        ...process.env as Record<string, string>,
        BITWARDENCLI_APPDATA_DIR: getDataDir(workspaceId),
        NODE_NO_WARNINGS: "1",
    };
}

/**
 * Pre-seed data.json with the trusted device ID before bw login.
 * This prevents Bitwarden from treating the container as a new device.
 */
function seedDataDir(workspaceId: string): void {
    const dataDir = getDataDir(workspaceId);
    mkdirSync(dataDir, { recursive: true });

    const dataFile = `${dataDir}/data.json`;

    // If data.json already exists and has our device ID, skip
    if (existsSync(dataFile)) {
        try {
            const existing = JSON.parse(readFileSync(dataFile, "utf-8"));
            if (existing["global_applicationId_appId"] === BW_DEVICE_ID) {
                return;
            }
        } catch {
            // Corrupted file — overwrite
        }
    }

    // Write minimal data.json with the trusted device ID
    writeFileSync(dataFile, JSON.stringify({
        "global_applicationId_appId": BW_DEVICE_ID,
    }));

    logger.info({ workspaceId, deviceId: BW_DEVICE_ID }, "Seeded BW data dir with trusted device ID");
}

async function runBw(
    args: string[],
    workspaceId: string,
    sessionKey?: string
): Promise<string> {
    const finalArgs = [...args];
    if (sessionKey) {
        finalArgs.push("--session", sessionKey);
    }

    const { stdout, stderr } = await execFileAsync("bw", finalArgs, {
        env: bwEnv(workspaceId),
        timeout: 30_000,
        maxBuffer: 10 * 1024 * 1024,
    });

    if (stderr && !stderr.includes("You are already logged in")) {
        logger.debug({ stderr, args: args[0] }, "bw stderr");
    }

    return stdout.trim();
}

/**
 * Run bw login interactively via spawn — pipes verification code via stdin
 * when Bitwarden prompts for it.
 */
function runBwLoginInteractive(
    email: string,
    password: string,
    workspaceId: string,
    verificationCode: string
): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn("bw", ["login", email, password, "--raw"], {
            env: {
                ...bwEnv(workspaceId),
                // Allow interactive prompts so we can pipe the code
            },
            stdio: ["pipe", "pipe", "pipe"],
            timeout: 30_000,
        });

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (data: Buffer) => {
            stdout += data.toString();
        });

        child.stderr.on("data", (data: Buffer) => {
            const chunk = data.toString();
            stderr += chunk;

            // When CLI prompts for the verification code, write it to stdin
            if (
                chunk.toLowerCase().includes("code") ||
                chunk.toLowerCase().includes("two-step") ||
                chunk.includes("?")
            ) {
                child.stdin.write(verificationCode.trim() + "\n");
                child.stdin.end();
            }
        });

        child.on("close", (code) => {
            const sessionKey = stdout.trim();

            if (code === 0 && sessionKey.length > 10) {
                resolve(sessionKey);
            } else {
                const err = new Error(stderr.trim() || `bw login exited with code ${code}`);
                (err as any).stderr = stderr;
                reject(err);
            }
        });

        child.on("error", reject);
    });
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VaultItem {
    username: string;
    password: string;
    uri: string;
    name: string;
}

// ─── Connect (login + get session key) ───────────────────────────────────────

export async function connectVault(
    email: string,
    masterPassword: string,
    workspaceId: string,
    verificationCode?: string
): Promise<{ sessionKey: string; email: string }> {
    // Pre-seed data dir with trusted device ID
    seedDataDir(workspaceId);

    // Logout any previous session (ignore errors)
    try {
        await runBw(["logout"], workspaceId);
    } catch {
        // Not logged in — fine
    }

    // Set server config to official Bitwarden (in case it was changed)
    try {
        await runBw(["config", "server", "https://vault.bitwarden.com"], workspaceId);
    } catch {
        // Config may already be set — fine
    }

    logger.info(
        { hasVerificationCode: !!verificationCode, workspaceId },
        "Running bw login"
    );

    try {
        let sessionKey: string;

        if (verificationCode) {
            // Use interactive spawn to pipe the verification code via stdin
            sessionKey = await runBwLoginInteractive(
                email,
                masterPassword,
                workspaceId,
                verificationCode
            );
        } else {
            // Normal non-interactive login (works when device is trusted)
            const args = ["login", email, masterPassword, "--raw"];
            sessionKey = await runBw(args, workspaceId);
        }

        if (!sessionKey || sessionKey.length < 10) {
            throw new Error("Login succeeded but no session key was returned.");
        }

        return { sessionKey, email };
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        const stderr = (error as { stderr?: string })?.stderr || "";
        const combined = `${msg} ${stderr}`.toLowerCase();

        logger.error({ stderr, msg, hasOtp: !!verificationCode }, "bw login failed");

        // Device verification / two-step code needed
        if (
            combined.includes("two-step") ||
            combined.includes("code is required") ||
            combined.includes("new device")
        ) {
            if (verificationCode) {
                // Code was provided but still failed — code is wrong or expired
                const err = new Error(
                    "Verification code is invalid or expired. Check your email for the latest code."
                );
                (err as any).code = "DEVICE_VERIFICATION_INVALID";
                throw err;
            }
            const err = new Error(
                "Device verification required. Check your email for a code from Bitwarden."
            );
            (err as any).code = "DEVICE_VERIFICATION_REQUIRED";
            throw err;
        }

        // Bad credentials
        if (
            combined.includes("username or password") ||
            combined.includes("unauthorized")
        ) {
            const err = new Error(
                "Invalid email or master password. Please try again."
            );
            (err as any).code = "AUTH_FAILED";
            throw err;
        }

        // Pass raw error through
        const err = new Error(stderr || msg);
        (err as any).code = "VAULT_CONNECTION_FAILED";
        throw err;
    }
}

// ─── Save Connection to DB ───────────────────────────────────────────────────

export async function saveConnection(
    workspaceId: string,
    sessionKey: string,
    email: string
) {
    // Delete existing connection first
    await vaultRepository.deleteByWorkspace(workspaceId);

    const connection = await vaultRepository.create({
        workspaceId,
        provider: "bitwarden",
        encryptedAccessToken: encrypt(sessionKey),
        encryptedRefreshToken: encrypt("cli-session"),
        encryptedVaultKey: encrypt(sessionKey),
        email,
        kdfIterations: 0,
        tokenExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        deviceIdentifier: BW_DEVICE_ID,
        status: "active",
    });

    return connection;
}

// ─── Get Credential ──────────────────────────────────────────────────────────

export async function getCredential(
    workspaceId: string,
    searchTerm: string
): Promise<VaultItem | null> {
    const connection = await vaultRepository.findByWorkspace(workspaceId);
    if (!connection || connection.status !== "active") {
        throw new Error("No active vault connection found");
    }

    const sessionKey = decrypt(connection.encryptedAccessToken);

    // Sync vault first to get latest items
    try {
        await runBw(["sync"], workspaceId, sessionKey);
    } catch (error) {
        logger.warn({ error, workspaceId }, "Vault sync failed, using cached data");
    }

    // List items matching search
    let raw: string;
    try {
        raw = await runBw(
            ["list", "items", "--search", searchTerm],
            workspaceId,
            sessionKey
        );
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);

        if (msg.includes("locked") || msg.includes("not logged in")) {
            await vaultRepository.updateStatus(connection.id, "failed");
            throw new Error("Vault session expired. Please reconnect your Bitwarden vault.");
        }
        throw error;
    }

    const items = JSON.parse(raw);
    if (!items || items.length === 0) {
        await vaultRepository.logAudit({
            workspaceId,
            connectionId: connection.id,
            action: "credential_fetch",
            itemName: searchTerm,
            success: false,
            errorMessage: "No matching login item found",
        });
        return null;
    }

    // Find best match — prefer login items (type 1)
    const loginItems = items.filter((i: any) => i.type === 1);
    const match = loginItems[0] || items[0];

    if (!match?.login) {
        return null;
    }

    const result: VaultItem = {
        name: match.name || "",
        username: match.login.username || "",
        password: match.login.password || "",
        uri: match.login.uris?.[0]?.uri || "",
    };

    await vaultRepository.logAudit({
        workspaceId,
        connectionId: connection.id,
        action: "credential_fetch",
        itemName: searchTerm,
        success: true,
        metadata: { matchedName: match.name },
    });

    return result;
}

// ─── Test Connection ──────────────────────────────────────────────────────────

export async function testConnection(
    workspaceId: string
): Promise<{ success: boolean; error?: string }> {
    const connection = await vaultRepository.findByWorkspace(workspaceId);
    if (!connection) {
        return { success: false, error: "No vault connection found" };
    }

    const sessionKey = decrypt(connection.encryptedAccessToken);

    try {
        await runBw(["sync"], workspaceId, sessionKey);
        const raw = await runBw(["list", "items"], workspaceId, sessionKey);
        const items = JSON.parse(raw);

        await vaultRepository.updateStatus(connection.id, "active");
        await vaultRepository.logAudit({
            workspaceId,
            connectionId: connection.id,
            action: "test",
            success: true,
            metadata: { itemCount: items.length },
        });

        return { success: true };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Connection test failed";
        await vaultRepository.updateStatus(connection.id, "failed");
        await vaultRepository.logAudit({
            workspaceId,
            connectionId: connection.id,
            action: "test",
            success: false,
            errorMessage: message,
        });
        return { success: false, error: message };
    }
}

// ─── Disconnect ──────────────────────────────────────────────────────────────

export async function disconnectVault(workspaceId: string): Promise<void> {
    const connection = await vaultRepository.findByWorkspace(workspaceId);

    try {
        await runBw(["logout"], workspaceId);
    } catch {
        // Already logged out
    }

    try {
        rmSync(getDataDir(workspaceId), { recursive: true, force: true });
    } catch {
        // Dir may not exist
    }

    if (connection) {
        await vaultRepository.logAudit({
            workspaceId,
            connectionId: connection.id,
            action: "disconnect",
            success: true,
        });
    }

    await vaultRepository.deleteByWorkspace(workspaceId);
}
