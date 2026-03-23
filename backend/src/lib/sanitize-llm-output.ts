/**
 * Strips tool-call markup that LLMs sometimes embed directly in their
 * text responses. This prevents raw tool-call content from leaking into the UI
 * or polluting conversation history (which can reinforce the model to keep
 * outputting tool calls as text).
 *
 * Applied as defense-in-depth at both the streaming layer and the persistence
 * layer so that:
 *   1. Users never see tool-call markup in real-time streams
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
 * Strip JSON tool call objects from text. Claude sometimes outputs tool calls
 * as JSON text like {"tool_calls":[{"name":"TOOL","input":{...}}]} instead of
 * using the API's native tool_use blocks.
 *
 * Uses brace counting for proper nested JSON handling (regex can't match
 * balanced braces reliably).
 */
function stripJsonToolCallObjects(text: string): string {
    const marker = '"tool_calls"';
    if (!text.includes(marker)) return text;

    let result = text;
    let searchFrom = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
        const markerIdx = result.indexOf(marker, searchFrom);
        if (markerIdx === -1) break;

        // Walk backwards to find the opening { before "tool_calls"
        let start = markerIdx - 1;
        while (start >= 0 && /\s/.test(result[start])) start--;
        if (start < 0 || result[start] !== '{') {
            searchFrom = markerIdx + marker.length;
            continue;
        }

        // Brace counting to find the matching }
        let depth = 0;
        let end = -1;
        for (let i = start; i < result.length; i++) {
            if (result[i] === '{') depth++;
            else if (result[i] === '}') {
                depth--;
                if (depth === 0) {
                    end = i + 1;
                    break;
                }
            }
        }

        if (end === -1) break;

        // Verify it's actually a tool_calls JSON object before stripping
        try {
            const parsed = JSON.parse(result.substring(start, end));
            if (Array.isArray(parsed.tool_calls)) {
                result = result.substring(0, start) + result.substring(end);
                continue; // Don't advance searchFrom since we removed content
            }
        } catch { /* not valid JSON, skip */ }

        searchFrom = end;
    }

    return result;
}

/**
 * Remove tool-call markup from LLM text output.
 *
 * Safe to call on every chunk during streaming — the regex set is compiled
 * once and handles both complete and partial (mid-stream) tags.
 *
 * NOTE: Does NOT trim the result so that whitespace between streamed chunks
 * is preserved. Use {@link stripToolCallXmlFinal} for the accumulated result.
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

    // 6. JSON tool call objects: {"tool_calls":[...]}
    // Claude sometimes outputs tool calls as JSON text instead of using
    // the API's native tool_use blocks. Strip them to prevent polluting
    // conversation history (which reinforces the bad behavior).
    cleaned = stripJsonToolCallObjects(cleaned);

    // 7. Collapse excessive whitespace left behind (but don't trim — preserves
    //    leading/trailing spaces that separate streamed tokens)
    cleaned = cleaned.replace(WHITESPACE_COLLAPSE_RE, "\n\n");

    return cleaned;
}

/**
 * Sanitize the fully-accumulated content after streaming is complete.
 * Same as {@link stripToolCallXml} but also trims leading/trailing whitespace.
 */
export function stripToolCallXmlFinal(text: string): string {
    return stripToolCallXml(text).trim();
}
