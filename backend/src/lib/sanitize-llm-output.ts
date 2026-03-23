/**
 * Strips tool-call XML markup that LLMs sometimes embed directly in their
 * text responses. This prevents raw XML from leaking into the UI.
 *
 * Applied as defense-in-depth at both the streaming layer and the persistence
 * layer so that:
 *   1. Users never see tool-call XML in real-time streams
 *   2. Historical messages stored in the DB are already clean
 */

// All known tool-call XML tag names (escaped for regex)
const TOOL_TAGS = [
    "function_calls",
    "function_call",
    "tool_calls",
    "tool_call",
    "tool_use",
    "antml:invoke",
    "antml:function_calls",
    "antml_invoke",
    "invoke",
].map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

// Pre-compiled regexes for performance (run on every streamed chunk)
const COMPLETE_BLOCK_RE = new RegExp(
    TOOL_TAGS.map((t) => `<${t}[^>]*>[\\s\\S]*?<\\/${t}>`).join("|"),
    "gi"
);

const ORPHANED_OPEN_RE = new RegExp(
    TOOL_TAGS.map((t) => `<${t}[^>]*>[\\s\\S]*$`).join("|"),
    "gi"
);

const STRAY_TAG_RE = new RegExp(
    TOOL_TAGS.map((t) => `<\\/?${t}[^>]*>`).join("|"),
    "gi"
);

// Standalone JSON arrays that look like tool calls: [{"tool_name": "...", ...}]
const JSON_TOOL_ARRAY_RE =
    /\[\s*\{\s*"tool_name"\s*:\s*"[^"]*"[\s\S]*?\}\s*\]/g;

// Partial opening tag at end of string (streaming edge case)
const PARTIAL_TAG_END_RE =
    /<(?:func(?:tion)?_?c?a?l?l?s?|tool_?(?:c(?:a(?:l(?:ls?)?)?)?|u(?:se?)?)?|antml?:?(?:i(?:n(?:v(?:o(?:ke?)?)?)?)?|f(?:u(?:n(?:c(?:t(?:i(?:o(?:n(?:_(?:c(?:a(?:l(?:ls?)?)?)?)?)?)?)?)?)?)?)?)?)?)\s*$/i;

const WHITESPACE_COLLAPSE_RE = /\n{3,}/g;

/**
 * Remove tool-call XML from LLM text output.
 *
 * Safe to call on every chunk during streaming — the regex set is compiled
 * once and handles both complete and partial (mid-stream) tags.
 */
export function stripToolCallXml(text: string): string {
    if (!text) return text;

    let cleaned = text;

    // 1. Complete <tag>...</tag> blocks
    cleaned = cleaned.replace(COMPLETE_BLOCK_RE, "");

    // 2. Orphaned opening tags (unclosed — common during streaming)
    cleaned = cleaned.replace(ORPHANED_OPEN_RE, "");

    // 3. Any remaining stray opening/closing tags
    cleaned = cleaned.replace(STRAY_TAG_RE, "");

    // 4. Standalone JSON tool-call arrays not wrapped in XML
    cleaned = cleaned.replace(JSON_TOOL_ARRAY_RE, "");

    // 5. Partial tag being formed at the very end during streaming
    cleaned = cleaned.replace(PARTIAL_TAG_END_RE, "");

    // 6. Collapse excessive whitespace left behind
    cleaned = cleaned.replace(WHITESPACE_COLLAPSE_RE, "\n\n").trim();

    return cleaned;
}
