export type ArtifactType = 'html' | 'markdown' | 'mdx' | 'txt' | 'csv' | 'xlsx' | 'pdf';

export interface Artifact {
    type: ArtifactType;
    filename: string;
    content: string;
}

// Match with closing tag
const ARTIFACT_CLOSED_REGEX = /<artifact\s+type="([^"]+)"(?:\s+filename="([^"]*)")?\s*>([\s\S]*?)<\/artifact>/;

// Global version — finds ALL closed artifact blocks
const ARTIFACT_CLOSED_REGEX_G = /<artifact\s+type="([^"]+)"(?:\s+filename="([^"]*)")?\s*>([\s\S]*?)<\/artifact>/g;

// Match opening tag without closing — treat rest of message as content
const ARTIFACT_OPEN_REGEX = /<artifact\s+type="([^"]+)"(?:\s+filename="([^"]*)")?\s*>([\s\S]*)$/;

const VALID_TYPES = new Set<string>(['html', 'markdown', 'mdx', 'txt', 'csv', 'xlsx', 'pdf']);

/** Parse ALL artifacts from a message (supports multiple artifact blocks). */
export function parseAllArtifacts(message: string): { artifacts: Artifact[]; cleanMessage: string } {
    const artifacts: Artifact[] = [];
    let cleanMessage = message;

    // Find all closed artifact blocks
    for (const match of message.matchAll(ARTIFACT_CLOSED_REGEX_G)) {
        const rawType = match[1].trim().toLowerCase();
        if (!VALID_TYPES.has(rawType)) continue;

        const type = rawType as ArtifactType;
        const filename = match[2]?.trim() || `artifact.${type === 'markdown' ? 'md' : type}`;
        const content = match[3].trim();
        if (!content) continue;

        artifacts.push({ type, filename, content });
        cleanMessage = cleanMessage.replace(match[0], '');
    }

    // Also check for an unclosed artifact tag at the end (streaming leftover / truncated)
    const openMatch = cleanMessage.match(ARTIFACT_OPEN_REGEX);
    if (openMatch) {
        const rawType = openMatch[1].trim().toLowerCase();
        if (VALID_TYPES.has(rawType)) {
            const type = rawType as ArtifactType;
            const filename = openMatch[2]?.trim() || `artifact.${type === 'markdown' ? 'md' : type}`;
            const content = openMatch[3].trim();
            if (content) {
                artifacts.push({ type, filename, content });
                cleanMessage = cleanMessage.replace(ARTIFACT_OPEN_REGEX, '');
            }
        }
    }

    cleanMessage = cleanMessage.replace(/\n{3,}/g, '\n\n').trim();

    return { artifacts, cleanMessage };
}

/** Backward-compatible single-artifact parser. Returns only the first artifact. */
export function parseArtifact(message: string): { artifact: Artifact | null; cleanMessage: string } {
    const { artifacts, cleanMessage } = parseAllArtifacts(message);
    return { artifact: artifacts[0] ?? null, cleanMessage };
}

// Detect an artifact tag during streaming — strips raw XML from visible text
// Returns streaming artifact metadata (type/filename) so UI can show a loading card
// Also matches partial opening tags like `<artifact` or `<artifact type="html"` that haven't closed `>` yet

const ARTIFACT_PARTIAL_TAG_REGEX = /<artifact(?:\s[^>]*)?\s*$/;

export interface StreamingArtifactResult {
    /** true if an artifact tag (complete or partial) was detected */
    isArtifactStreaming: boolean;
    /** text content before the artifact tag — safe to render */
    cleanMessage: string;
    /** artifact type if detected from the tag */
    type?: ArtifactType;
    /** artifact filename if detected from the tag */
    filename?: string;
}

export function detectStreamingArtifact(message: string): StreamingArtifactResult {
    // Strip any already-completed artifact blocks first so they don't leak as raw text.
    // We use parseAllArtifacts which handles multiple closed blocks.
    const { artifacts: completedArtifacts, cleanMessage: strippedMessage } = parseAllArtifacts(message);

    // Now check the stripped message for a still-streaming artifact (open tag without close)
    const openMatch = strippedMessage.match(ARTIFACT_OPEN_REGEX);
    if (openMatch) {
        const rawType = openMatch[1]?.trim().toLowerCase();
        const type = VALID_TYPES.has(rawType) ? (rawType as ArtifactType) : undefined;
        const filename = openMatch[2]?.trim() || undefined;
        const cleanMessage = strippedMessage.slice(0, openMatch.index ?? 0).trim();
        return { isArtifactStreaming: true, cleanMessage, type, filename };
    }

    // Check for partial tag (e.g. `<artifact` or `<artifact type="html"` — no closing `>` yet)
    const partialMatch = strippedMessage.match(ARTIFACT_PARTIAL_TAG_REGEX);
    if (partialMatch) {
        const cleanMessage = strippedMessage.slice(0, partialMatch.index ?? 0).trim();
        return { isArtifactStreaming: true, cleanMessage };
    }

    // No streaming artifact — return cleaned message (completed artifacts already stripped)
    return {
        isArtifactStreaming: false,
        cleanMessage: strippedMessage,
        type: completedArtifacts[completedArtifacts.length - 1]?.type,
        filename: completedArtifacts[completedArtifacts.length - 1]?.filename,
    };
}

export function getLanguageFromType(type: ArtifactType): string {
    switch (type) {
        case 'html':
            return 'html';
        case 'markdown':
        case 'mdx':
            return 'markdown';
        case 'csv':
        case 'xlsx':
            return 'csv';
        case 'txt':
            return 'plaintext';
        case 'pdf':
            return 'html';
        default:
            return 'plaintext';
    }
}
