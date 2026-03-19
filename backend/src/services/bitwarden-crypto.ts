import crypto from "crypto";

// ─── Key Derivation ──────────────────────────────────────────────────────────

/**
 * Derive the master key from the user's master password using PBKDF2-SHA256.
 * Salt is the user's email (lowercased, trimmed, UTF-8 encoded).
 * Returns a 32-byte Buffer.
 */
export function derivePreloginKey(
    masterPassword: string,
    email: string,
    kdfIterations: number
): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const salt = Buffer.from(email.trim().toLowerCase(), "utf8");
        const password = Buffer.from(masterPassword, "utf8");
        crypto.pbkdf2(password, salt, kdfIterations, 32, "sha256", (err, key) => {
            if (err) reject(err);
            else resolve(key);
        });
    });
}

/**
 * Hash the master password for the Bitwarden auth endpoint.
 * This is a second PBKDF2 pass: key=masterKey, salt=masterPassword, 1 iteration.
 * Returns a base64 string.
 */
export function hashPassword(
    masterPassword: string,
    masterKey: Buffer
): Promise<string> {
    return new Promise((resolve, reject) => {
        const salt = Buffer.from(masterPassword, "utf8");
        crypto.pbkdf2(masterKey, salt, 1, 32, "sha256", (err, hash) => {
            if (err) reject(err);
            else resolve(hash.toString("base64"));
        });
    });
}

/**
 * Stretch the 32-byte master key into a 32-byte encryption key and a 32-byte MAC key
 * using HKDF-expand with SHA-256.
 */
export function stretchKey(masterKey: Buffer): { encKey: Buffer; macKey: Buffer } {
    // HKDF-expand: T(1) = HMAC(PRK, info || 0x01)
    const encKey = crypto
        .createHmac("sha256", masterKey)
        .update(Buffer.concat([Buffer.from("enc", "utf8"), Buffer.from([0x01])]))
        .digest();

    const macKey = crypto
        .createHmac("sha256", masterKey)
        .update(Buffer.concat([Buffer.from("mac", "utf8"), Buffer.from([0x01])]))
        .digest();

    return { encKey, macKey };
}

// ─── CipherString Parsing & Decryption ────────────────────────────────────────

interface ParsedCipherString {
    type: number;
    iv: Buffer;
    ciphertext: Buffer;
    mac: Buffer | null;
}

/**
 * Parse a Bitwarden CipherString into its components.
 * Format: "type.iv|ciphertext|mac" (all base64-encoded after the type prefix).
 *
 * Type 2 = AES-256-CBC + HMAC-SHA256 (the standard encryption type).
 */
export function parseCipherString(cipherString: string): ParsedCipherString {
    const dotIndex = cipherString.indexOf(".");
    if (dotIndex === -1) {
        throw new Error("Invalid CipherString: missing type prefix");
    }

    const type = parseInt(cipherString.substring(0, dotIndex), 10);
    const remainder = cipherString.substring(dotIndex + 1);
    const parts = remainder.split("|");

    if (parts.length < 2) {
        throw new Error("Invalid CipherString: expected at least iv|ciphertext");
    }

    return {
        type,
        iv: Buffer.from(parts[0], "base64"),
        ciphertext: Buffer.from(parts[1], "base64"),
        mac: parts[2] ? Buffer.from(parts[2], "base64") : null,
    };
}

/**
 * Decrypt a CipherString using an encryption key and MAC key.
 * Verifies HMAC-SHA256 before decrypting (mandatory for type 2).
 * Returns the decrypted Buffer.
 */
export function decryptCipherString(
    cipherString: string,
    encKey: Buffer,
    macKey: Buffer
): Buffer {
    const parsed = parseCipherString(cipherString);

    if (parsed.type !== 2) {
        throw new Error(`Unsupported CipherString type: ${parsed.type}. Only type 2 (AES-256-CBC + HMAC) is supported.`);
    }

    // Verify HMAC before decryption (prevents padding oracle attacks)
    if (!parsed.mac) {
        throw new Error("CipherString type 2 requires an HMAC tag");
    }

    const computedMac = crypto
        .createHmac("sha256", macKey)
        .update(Buffer.concat([parsed.iv, parsed.ciphertext]))
        .digest();

    if (computedMac.length !== parsed.mac.length ||
        !crypto.timingSafeEqual(computedMac, parsed.mac)) {
        throw new Error("HMAC verification failed — data may be corrupted or tampered with");
    }

    // Decrypt with AES-256-CBC
    const decipher = crypto.createDecipheriv("aes-256-cbc", encKey, parsed.iv);
    const decrypted = Buffer.concat([
        decipher.update(parsed.ciphertext),
        decipher.final(),
    ]);

    return decrypted;
}

// ─── Vault Key Unwrapping ─────────────────────────────────────────────────────

/**
 * Decrypt the protected symmetric key returned by Bitwarden's auth endpoint.
 *
 * The auth response includes a "Key" field which is a CipherString containing
 * the 64-byte symmetric key pair (32-byte encKey + 32-byte macKey) encrypted
 * with the stretched master key.
 *
 * Flow: masterKey → stretchKey() → decrypt protectedKey → 64-byte result
 */
export function decryptProtectedSymmetricKey(
    protectedKeyString: string,
    masterKey: Buffer
): { encKey: Buffer; macKey: Buffer } {
    const { encKey: stretchedEnc, macKey: stretchedMac } = stretchKey(masterKey);

    const decryptedKeyBytes = decryptCipherString(
        protectedKeyString,
        stretchedEnc,
        stretchedMac
    );

    // Zero the stretched keys immediately after use
    stretchedEnc.fill(0);
    stretchedMac.fill(0);

    if (decryptedKeyBytes.length !== 64) {
        throw new Error(
            `Expected 64-byte symmetric key, got ${decryptedKeyBytes.length} bytes`
        );
    }

    // First 32 bytes = encryption key, last 32 bytes = MAC key
    const encKey = Buffer.alloc(32);
    const macKey = Buffer.alloc(32);
    decryptedKeyBytes.copy(encKey, 0, 0, 32);
    decryptedKeyBytes.copy(macKey, 0, 32, 64);

    // Zero the combined buffer
    decryptedKeyBytes.fill(0);

    return { encKey, macKey };
}

// ─── Convenience Helpers ──────────────────────────────────────────────────────

/**
 * Decrypt a single vault item field (name, username, password, URI, etc.).
 * Returns the plaintext string, or null if the input is empty/null.
 */
export function decryptVaultField(
    cipherString: string | null | undefined,
    encKey: Buffer,
    macKey: Buffer
): string | null {
    if (!cipherString) return null;
    try {
        const decrypted = decryptCipherString(cipherString, encKey, macKey);
        return decrypted.toString("utf8");
    } catch {
        // Field may be encrypted with an organization key we don't have
        return null;
    }
}

/**
 * Serialize a vault key pair (encKey + macKey) to a hex string for storage.
 */
export function serializeVaultKey(encKey: Buffer, macKey: Buffer): string {
    return Buffer.concat([encKey, macKey]).toString("hex");
}

/**
 * Deserialize a hex-encoded vault key string back into encKey + macKey buffers.
 */
export function deserializeVaultKey(hex: string): { encKey: Buffer; macKey: Buffer } {
    const combined = Buffer.from(hex, "hex");
    if (combined.length !== 64) {
        throw new Error(`Expected 64-byte vault key, got ${combined.length} bytes`);
    }
    const encKey = Buffer.alloc(32);
    const macKey = Buffer.alloc(32);
    combined.copy(encKey, 0, 0, 32);
    combined.copy(macKey, 0, 32, 64);
    combined.fill(0);
    return { encKey, macKey };
}

/**
 * Zero out key buffers to minimize time sensitive material stays in memory.
 */
export function zeroBuffers(...buffers: Buffer[]): void {
    for (const buf of buffers) {
        buf.fill(0);
    }
}
