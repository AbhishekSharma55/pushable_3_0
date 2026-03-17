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
