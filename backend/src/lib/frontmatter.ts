/**
 * Parse YAML-like frontmatter from markdown content.
 * Supports the format:
 * ---
 * name: value
 * description: value
 * origin: value
 * ---
 *
 * # Body content here
 */
export function parseFrontmatter(content: string): {
    metadata: Record<string, string>;
    body: string;
} {
    const trimmed = content.trim();
    if (!trimmed.startsWith("---")) {
        return { metadata: {}, body: content };
    }

    const endIndex = trimmed.indexOf("---", 3);
    if (endIndex === -1) {
        return { metadata: {}, body: content };
    }

    const frontmatterBlock = trimmed.slice(3, endIndex).trim();
    const body = trimmed.slice(endIndex + 3).trim();

    const metadata: Record<string, string> = {};
    for (const line of frontmatterBlock.split("\n")) {
        const colonIndex = line.indexOf(":");
        if (colonIndex === -1) continue;
        const key = line.slice(0, colonIndex).trim();
        const value = line.slice(colonIndex + 1).trim();
        if (key && value) {
            metadata[key] = value;
        }
    }

    return { metadata, body };
}

/**
 * Check if content contains frontmatter.
 */
export function hasFrontmatter(content: string): boolean {
    const trimmed = content.trim();
    if (!trimmed.startsWith("---")) return false;
    const endIndex = trimmed.indexOf("---", 3);
    return endIndex !== -1;
}
