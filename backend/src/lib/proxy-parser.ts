interface ParsedProxy {
    host: string;
    port: number;
    username: string;
    password: string;
    protocol: "http" | "https" | "socks5";
}

/**
 * Parse a raw proxy connection string into components.
 * Supports:
 *   - username:password@host:port
 *   - protocol://username:password@host:port
 *   - host:port:username:password
 */
export function parseProxyString(raw: string): ParsedProxy | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    // Format: protocol://username:password@host:port
    const urlMatch = trimmed.match(
        /^(https?|socks5):\/\/([^:]+):([^@]+)@([^:]+):(\d+)$/
    );
    if (urlMatch) {
        return {
            protocol: urlMatch[1] as ParsedProxy["protocol"],
            username: urlMatch[2],
            password: urlMatch[3],
            host: urlMatch[4],
            port: parseInt(urlMatch[5], 10),
        };
    }

    // Format: username:password@host:port
    const userPassAtHostPort = trimmed.match(
        /^([^:]+):([^@]+)@([^:]+):(\d+)$/
    );
    if (userPassAtHostPort) {
        return {
            protocol: "http",
            username: userPassAtHostPort[1],
            password: userPassAtHostPort[2],
            host: userPassAtHostPort[3],
            port: parseInt(userPassAtHostPort[4], 10),
        };
    }

    // Format: host:port:username:password
    const colonSeparated = trimmed.match(
        /^([^:]+):(\d+):([^:]+):(.+)$/
    );
    if (colonSeparated) {
        return {
            protocol: "http",
            host: colonSeparated[1],
            port: parseInt(colonSeparated[2], 10),
            username: colonSeparated[3],
            password: colonSeparated[4],
        };
    }

    return null;
}

/**
 * Format a proxy record into the URL format that Camoufox/Playwright expects.
 * Returns: http://username:password@host:port
 */
export function formatProxyUrl(proxy: {
    protocol: string;
    username: string;
    password: string;
    host: string;
    port: number;
}): string {
    return `${proxy.protocol}://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`;
}
