import crypto from "crypto";

interface PendingVerification {
    code: string;
    workspaceId: string;
    userId: string;
    expiresAt: number;
}

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute

// code → verification data
const pendingCodes = new Map<string, PendingVerification>();
// workspaceId:userId → code (for deduplication)
const userCodes = new Map<string, string>();

function generateCode(): string {
    return crypto.randomBytes(3).toString("hex").toUpperCase(); // 6 hex chars
}

export function generateVerificationCode(
    workspaceId: string,
    userId: string
): string {
    const userKey = `${workspaceId}:${userId}`;

    // Remove existing code for this user+workspace
    const existingCode = userCodes.get(userKey);
    if (existingCode) {
        pendingCodes.delete(existingCode);
        userCodes.delete(userKey);
    }

    const code = generateCode();
    pendingCodes.set(code, {
        code,
        workspaceId,
        userId,
        expiresAt: Date.now() + CODE_TTL_MS,
    });
    userCodes.set(userKey, code);

    return code;
}

export function validateAndConsume(
    code: string
): { workspaceId: string; userId: string } | null {
    const entry = pendingCodes.get(code.toUpperCase());
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        pendingCodes.delete(code.toUpperCase());
        userCodes.delete(`${entry.workspaceId}:${entry.userId}`);
        return null;
    }

    // Consume the code
    pendingCodes.delete(code.toUpperCase());
    userCodes.delete(`${entry.workspaceId}:${entry.userId}`);

    return { workspaceId: entry.workspaceId, userId: entry.userId };
}

// Periodic cleanup of expired codes
setInterval(() => {
    const now = Date.now();
    for (const [code, entry] of pendingCodes) {
        if (now > entry.expiresAt) {
            pendingCodes.delete(code);
            userCodes.delete(`${entry.workspaceId}:${entry.userId}`);
        }
    }
}, CLEANUP_INTERVAL_MS);
