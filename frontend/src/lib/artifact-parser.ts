export type ArtifactType = 'html' | 'markdown' | 'mdx' | 'txt' | 'csv' | 'xlsx' | 'pdf';

export interface Artifact {
    type: ArtifactType;
    filename: string;
    content: string;
}

// Match with closing tag
const ARTIFACT_CLOSED_REGEX = /<artifact\s+type="([^"]+)"(?:\s+filename="([^"]*)")?\s*>([\s\S]*?)<\/artifact>/;

// Match opening tag without closing — treat rest of message as content
const ARTIFACT_OPEN_REGEX = /<artifact\s+type="([^"]+)"(?:\s+filename="([^"]*)")?\s*>([\s\S]*)$/;

const VALID_TYPES = new Set<string>(['html', 'markdown', 'mdx', 'txt', 'csv', 'xlsx', 'pdf']);

export function parseArtifact(message: string): { artifact: Artifact | null; cleanMessage: string } {
    // Try closed tag first (proper format)
    let match = message.match(ARTIFACT_CLOSED_REGEX);
    let regex: RegExp = ARTIFACT_CLOSED_REGEX;

    // Fallback: opening tag without closing tag
    if (!match) {
        match = message.match(ARTIFACT_OPEN_REGEX);
        regex = ARTIFACT_OPEN_REGEX;
    }

    if (!match) {
        return { artifact: null, cleanMessage: message };
    }

    const rawType = match[1].trim().toLowerCase();
    if (!VALID_TYPES.has(rawType)) {
        return { artifact: null, cleanMessage: message };
    }

    const type = rawType as ArtifactType;
    const filename = match[2]?.trim() || `artifact.${type === 'markdown' ? 'md' : type}`;
    const content = match[3].trim();

    if (!content) {
        return { artifact: null, cleanMessage: message };
    }

    const cleanMessage = message.replace(regex, '').trim();

    return { artifact: { type, filename, content }, cleanMessage };
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
    // First check: is there a complete closed artifact? (agent finished it in one chunk)
    if (ARTIFACT_CLOSED_REGEX.test(message)) {
        const parsed = parseArtifact(message);
        return {
            isArtifactStreaming: false,
            cleanMessage: parsed.cleanMessage,
            type: parsed.artifact?.type,
            filename: parsed.artifact?.filename,
        };
    }

    // Second check: opening tag present (content is streaming)
    const openMatch = message.match(ARTIFACT_OPEN_REGEX);
    if (openMatch) {
        const rawType = openMatch[1]?.trim().toLowerCase();
        const type = VALID_TYPES.has(rawType) ? (rawType as ArtifactType) : undefined;
        const filename = openMatch[2]?.trim() || undefined;
        const cleanMessage = message.slice(0, openMatch.index ?? 0).trim();
        return { isArtifactStreaming: true, cleanMessage, type, filename };
    }

    // Third check: partial tag (e.g. `<artifact` or `<artifact type="html"` — no closing `>` yet)
    const partialMatch = message.match(ARTIFACT_PARTIAL_TAG_REGEX);
    if (partialMatch) {
        const cleanMessage = message.slice(0, partialMatch.index ?? 0).trim();
        return { isArtifactStreaming: true, cleanMessage };
    }

    return { isArtifactStreaming: false, cleanMessage: message };
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
