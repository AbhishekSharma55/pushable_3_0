import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;

function getEncryptionKey(): Buffer {
    const key = process.env.VAULT_ENCRYPTION_KEY || process.env.JWT_SECRET;
    if (!key) throw new Error("No encryption key available (set VAULT_ENCRYPTION_KEY or JWT_SECRET)");
    // Derive a 32-byte key from the secret using SHA-256
    return crypto.createHash("sha256").update(key).digest();
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns a combined string: iv:encrypted:authTag (all hex-encoded).
 */
export function encrypt(plaintext: string): string {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");
    return `${iv.toString("hex")}:${encrypted}:${authTag}`;
}

/**
 * Decrypt a string encrypted by the encrypt() function.
 */
export function decrypt(encryptedString: string): string {
    const key = getEncryptionKey();
    const parts = encryptedString.split(":");
    if (parts.length !== 3) throw new Error("Invalid encrypted format");
    const iv = Buffer.from(parts[0], "hex");
    const encrypted = parts[1];
    const authTag = Buffer.from(parts[2], "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
}
