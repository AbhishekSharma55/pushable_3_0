import crypto from "crypto";

// ─── Configuration ────────────────────────────────────────────────────────────

const IDENTITY_URL =
    process.env.BITWARDEN_IDENTITY_URL || "https://identity.bitwarden.com";
const API_URL =
    process.env.BITWARDEN_API_URL || "https://api.bitwarden.com";
const CLIENT_VERSION = "2024.12.0";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PreloginResponse {
    kdf: number; // 0 = PBKDF2, 1 = Argon2id
    kdfIterations: number;
    kdfMemory?: number;
    kdfParallelism?: number;
}

export interface AuthResponse {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
    Key: string; // Protected symmetric key (CipherString)
    Kdf: number;
    KdfIterations: number;
}

export interface RefreshResponse {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
}

export interface CipherLogin {
    username: string | null; // CipherString
    password: string | null; // CipherString
    uris: Array<{ uri: string | null }> | null; // each uri is CipherString
}

export interface CipherItem {
    id: string;
    type: number; // 1=login, 2=secure note, 3=card, 4=identity
    name: string; // CipherString
    login: CipherLogin | null;
    notes: string | null; // CipherString
    organizationId: string | null;
}

export interface CiphersResponse {
    data: CipherItem[];
}

// ─── API Error ────────────────────────────────────────────────────────────────

export class BitwardenApiError extends Error {
    constructor(
        message: string,
        public statusCode: number,
        public errorCode?: string
    ) {
        super(message);
        this.name = "BitwardenApiError";
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Base64url-encode an email without padding (required by Bitwarden Auth-Email header) */
function encodeAuthEmail(email: string): string {
    return Buffer.from(email)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

// ─── API Functions ────────────────────────────────────────────────────────────

/**
 * Get KDF parameters for a Bitwarden account before authentication.
 * This tells us what key derivation function and iterations to use.
 */
export async function prelogin(email: string): Promise<PreloginResponse> {
    const response = await fetch(`${IDENTITY_URL}/accounts/prelogin`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Bitwarden-Client-Name": "web",
            "Bitwarden-Client-Version": CLIENT_VERSION,
            "Auth-Email": encodeAuthEmail(email),
        },
        body: JSON.stringify({ email }),
    });

    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new BitwardenApiError(
            `Prelogin failed: ${text || response.statusText}`,
            response.status
        );
    }

    const data = await response.json();

    if (data.kdf !== 0) {
        throw new BitwardenApiError(
            "Your Bitwarden account uses Argon2id key derivation, which is not yet supported. " +
                "Please switch to PBKDF2 in your Bitwarden vault settings, or contact support.",
            400,
            "UNSUPPORTED_KDF"
        );
    }

    return {
        kdf: data.kdf,
        kdfIterations: data.kdfIterations,
        kdfMemory: data.kdfMemory,
        kdfParallelism: data.kdfParallelism,
    };
}

/**
 * Authenticate with Bitwarden using the password grant flow.
 * Returns OAuth tokens and the protected symmetric key.
 *
 * The `hashedPassword` is NOT the raw master password — it's the base64-encoded
 * result of PBKDF2(masterKey, masterPassword, 1, 32, sha256).
 */
export async function authenticate(
    email: string,
    hashedPassword: string,
    deviceIdentifier: string,
    otp?: string
): Promise<AuthResponse> {
    const bodyParams: Record<string, string> = {
        grant_type: "password",
        username: email,
        password: hashedPassword,
        scope: "api offline_access",
        client_id: "web",
        deviceType: "9", // Web Vault
        deviceIdentifier,
        deviceName: "Pushable AI Platform",
    };

    // Include OTP in request body for new device verification
    if (otp) {
        bodyParams["OTP"] = otp.trim();
    }

    const body = new URLSearchParams(bodyParams);

    const headers: Record<string, string> = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Bitwarden-Client-Name": "web",
        "Bitwarden-Client-Version": CLIENT_VERSION,
        "Auth-Email": encodeAuthEmail(email),
    };

    // Also send OTP as header (some server versions read from headers)
    if (otp) {
        headers["OTP"] = otp.trim();
    }

    const response = await fetch(`${IDENTITY_URL}/connect/token`, {
        method: "POST",
        headers,
        body: body.toString(),
    });

    if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));

        // Handle 2FA requirement
        if (response.status === 400 && errorBody?.TwoFactorProviders) {
            throw new BitwardenApiError(
                "Your Bitwarden account has two-factor authentication enabled. " +
                    "Please disable 2FA temporarily to connect, or use Bitwarden API key authentication instead.",
                400,
                "TWO_FACTOR_REQUIRED"
            );
        }

        // Handle new device verification required
        if (response.status === 400) {
            const desc =
                errorBody?.error_description ||
                errorBody?.ErrorModel?.Message ||
                "";
            const descLower = desc.toLowerCase();
            if (
                descLower.includes("device verification") ||
                descLower.includes("new device")
            ) {
                // If OTP was provided but we still get this error, the code was invalid/expired
                if (otp) {
                    throw new BitwardenApiError(
                        "Verification code is invalid or expired. Please check your email for the latest code and try again.",
                        400,
                        "DEVICE_VERIFICATION_INVALID"
                    );
                }
                throw new BitwardenApiError(
                    "New device verification required. Check your email for a verification code from Bitwarden.",
                    400,
                    "DEVICE_VERIFICATION_REQUIRED"
                );
            }

            // Handle explicit OTP invalid response
            if (
                descLower.includes("otp") ||
                descLower.includes("verification code")
            ) {
                throw new BitwardenApiError(
                    "Verification code is invalid or expired. Please request a new code.",
                    400,
                    "DEVICE_VERIFICATION_INVALID"
                );
            }
        }

        // Handle invalid credentials
        if (response.status === 400) {
            const msg =
                errorBody?.ErrorModel?.Message ||
                errorBody?.error_description ||
                "Authentication failed";
            throw new BitwardenApiError(
                `Bitwarden login failed: ${msg}. Please check your email and master password.`,
                400,
                "AUTH_FAILED"
            );
        }

        throw new BitwardenApiError(
            `Authentication failed: ${response.statusText}`,
            response.status
        );
    }

    const data = await response.json();

    if (!data.Key) {
        throw new BitwardenApiError(
            "Authentication succeeded but no vault key was returned. This may indicate an account setup issue.",
            500,
            "NO_VAULT_KEY"
        );
    }

    return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
        token_type: data.token_type,
        Key: data.Key,
        Kdf: data.Kdf,
        KdfIterations: data.KdfIterations,
    };
}

/**
 * Refresh an expired access token using the refresh token.
 * Returns a new access token and refresh token pair.
 */
export async function refreshAccessToken(
    refreshToken: string
): Promise<RefreshResponse> {
    const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: "web",
    });

    const response = await fetch(`${IDENTITY_URL}/connect/token`, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Bitwarden-Client-Name": "web",
            "Bitwarden-Client-Version": CLIENT_VERSION,
        },
        body: body.toString(),
    });

    if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        const msg =
            errorBody?.error_description ||
            errorBody?.ErrorModel?.Message ||
            response.statusText;

        throw new BitwardenApiError(
            `Token refresh failed: ${msg}`,
            response.status,
            "REFRESH_FAILED"
        );
    }

    const data = await response.json();
    return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
        token_type: data.token_type,
    };
}

/**
 * Fetch all encrypted ciphers (vault items) from Bitwarden.
 * Requires a valid access token.
 */
export async function fetchCiphers(
    accessToken: string
): Promise<CiphersResponse> {
    const response = await fetch(`${API_URL}/ciphers`, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "Bitwarden-Client-Name": "web",
            "Bitwarden-Client-Version": CLIENT_VERSION,
        },
    });

    if (!response.ok) {
        if (response.status === 401) {
            throw new BitwardenApiError(
                "Access token expired or invalid",
                401,
                "TOKEN_EXPIRED"
            );
        }

        throw new BitwardenApiError(
            `Failed to fetch vault items: ${response.statusText}`,
            response.status
        );
    }

    const data = await response.json();
    return { data: data.data || [] };
}

/**
 * Generate a deterministic device identifier for a given email.
 * This ensures the same device ID is used across the initial connect attempt
 * and the subsequent OTP verification attempt, which is required by Bitwarden's
 * new device verification flow.
 */
export function generateDeviceIdentifier(email: string): string {
    const hash = crypto
        .createHash("sha256")
        .update(`pushable:device:${email.toLowerCase().trim()}`)
        .digest("hex");
    return [
        hash.slice(0, 8),
        hash.slice(8, 12),
        hash.slice(12, 16),
        hash.slice(16, 20),
        hash.slice(20, 32),
    ].join("-");
}
