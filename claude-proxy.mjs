#!/usr/bin/env node
/**
 * Claude CLI Proxy — translates Anthropic Messages API requests into
 * either direct API calls (for models that support it) or `claude --print`
 * CLI calls (for premium models via Claude Code subscription).
 *
 * Run on the HOST (not in Docker):
 *   node claude-proxy.mjs
 *
 * Then set in .env:
 *   CLAUDE_CLI_PROXY_URL=http://host.docker.internal:4006
 */

import { createServer } from "node:http";
import { spawn, execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import https from "node:https";

const PORT = parseInt(process.env.CLAUDE_PROXY_PORT || "4006", 10);
const ANTHROPIC_API_URL = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";

// Resolve full path to `claude` binary
const CLAUDE_BIN = process.env.CLAUDE_BIN || (() => {
    try {
        return execSync("which claude", { encoding: "utf-8" }).trim();
    } catch {
        return "claude";
    }
})();

// ── Credential loading ──────────────────────────────────────
function loadCredential() {
    if (process.env.ANTHROPIC_API_KEY) {
        return { token: process.env.ANTHROPIC_API_KEY, isApiKey: true };
    }

    const platform = process.platform;

    if (platform === "darwin") {
        try {
            const raw = execSync(
                'security find-generic-password -s "Claude Code-credentials" -w',
                { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
            ).trim();
            const creds = JSON.parse(raw);
            const token = creds?.claudeAiOauth?.accessToken;
            if (token) return { token, isApiKey: false };
        } catch { /* fall through */ }
    }

    if (platform === "linux") {
        try {
            const home = process.env.HOME || "/root";
            const raw = readFileSync(`${home}/.claude/.credentials.json`, "utf-8");
            const creds = JSON.parse(raw);
            const token = creds?.claudeAiOauth?.accessToken || creds?.accessToken || creds?.apiKey;
            if (token) return { token, isApiKey: !!creds?.apiKey };
        } catch { /* fall through */ }
    }

    return null;
}

let credential = loadCredential();

function refreshCredential() {
    const fresh = loadCredential();
    if (fresh) credential = fresh;
    return credential;
}

setInterval(refreshCredential, 5 * 60 * 1000);

if (credential) {
    console.log(`Auth: ${credential.isApiKey ? "API key" : "OAuth token"} loaded (${credential.token.slice(0, 12)}…)`);
    console.log(`Claude binary: ${CLAUDE_BIN}`);
} else {
    console.error(
        "ERROR: No credential found.\n" +
        "  macOS: run `claude auth login` first\n" +
        "  Linux: ensure ~/.claude/.credentials.json exists\n" +
        "  Or set ANTHROPIC_API_KEY env var"
    );
    process.exit(1);
}

// ── Direct API forwarding (for API keys or models that work with OAuth) ──

function forwardToAnthropic(bodyStr, res, isStreaming) {
    return new Promise((resolve) => {
        const options = {
            hostname: "api.anthropic.com",
            port: 443,
            path: "/v1/messages",
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-api-key": credential.token,
                "anthropic-version": ANTHROPIC_VERSION,
                "content-length": Buffer.byteLength(bodyStr),
            },
        };

        const apiReq = https.request(options, (apiRes) => {
            const statusCode = apiRes.statusCode || 500;

            if (statusCode === 401) {
                refreshCredential();
            }

            // Collect response to check for errors before piping
            let respBody = "";
            apiRes.on("data", (d) => (respBody += d));
            apiRes.on("end", () => {
                resolve({ statusCode, body: respBody, headers: apiRes.headers });
            });
        });

        apiReq.on("error", (err) => {
            resolve({ statusCode: 502, body: JSON.stringify({
                type: "error",
                error: { type: "api_error", message: err.message },
            }), headers: {} });
        });

        apiReq.write(bodyStr);
        apiReq.end();
    });
}

// ── CLI fallback (for premium models via Claude Code subscription) ──────

function flattenMessages(messages) {
    const parts = [];
    for (const msg of messages) {
        const role = msg.role === "user" ? "Human" : "Assistant";
        if (typeof msg.content === "string") {
            parts.push(`${role}: ${msg.content}`);
            continue;
        }
        const textParts = [];
        for (const block of msg.content) {
            if (block.type === "text") {
                textParts.push(block.text);
            } else if (block.type === "tool_use") {
                textParts.push(`[Calling tool "${block.name}" with input: ${JSON.stringify(block.input)}]`);
            } else if (block.type === "tool_result") {
                const text = typeof block.content === "string"
                    ? block.content
                    : block.content?.map((c) => c.text || JSON.stringify(c)).join("\n") || "";
                textParts.push(`[Tool "${block.tool_use_id}" returned: ${text}]`);
            }
        }
        if (textParts.length) {
            parts.push(`${role}: ${textParts.join("\n")}`);
        }
    }
    return parts.join("\n\n");
}

function buildToolSystemPrompt(systemPrompt, tools) {
    if (!tools?.length) return systemPrompt;

    const toolDefs = tools.map((t) =>
        `- ${t.name}: ${t.description || "No description"}. Parameters: ${JSON.stringify(t.input_schema || {})}`
    ).join("\n");

    return (systemPrompt || "") +
        `\n\nYou can invoke functions by outputting a JSON object. Available functions:\n${toolDefs}\n\n` +
        `CRITICAL RULE: When you want to call a function, your ENTIRE response must be ONLY the JSON object below — no greeting, no explanation, no text before or after:\n` +
        `{"tool_calls":[{"name":"function_name","input":{...}}]}\n\n` +
        `When you do not need to call a function, respond normally with text.`;
}

function runClaudeCLI(model, systemPrompt, prompt) {
    return new Promise((resolve, reject) => {
        const args = [
            "--print",
            "--model", model,
            "--output-format", "json",
            "--no-session-persistence",
            "--tools", "",
            "--strict-mcp-config",
        ];

        if (systemPrompt) {
            args.push("--system-prompt", systemPrompt);
        }

        const child = spawn(CLAUDE_BIN, args, {
            stdio: ["pipe", "pipe", "pipe"],
            env: { ...process.env },
        });

        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => (stdout += d));
        child.stderr.on("data", (d) => (stderr += d));
        child.stdin.write(prompt);
        child.stdin.end();

        child.on("close", (code) => {
            if (code !== 0 && !stdout) {
                reject(new Error(`claude exited ${code}: ${stderr}`));
                return;
            }
            try {
                resolve(JSON.parse(stdout));
            } catch {
                resolve({ result: stdout, is_error: false });
            }
        });
        child.on("error", reject);
    });
}

/**
 * Extract tool calls from text in any format the model might use:
 *   1. {"tool_calls":[{"name":"x","input":{...}}]}
 *   2. [Calling tool "x" with input: {...}]
 *   3. {"name":"x","input":{...}}  (bare tool call matching a known tool)
 */
function recoverToolCalls(text, toolNames) {
    const calls = [];

    // Format 1: {"tool_calls":[...]}
    const jsonMatch = text.match(/\{"tool_calls"\s*:\s*\[([\s\S]*?)\]\s*\}/);
    if (jsonMatch) {
        try {
            const parsed = JSON.parse(jsonMatch[0]);
            if (Array.isArray(parsed.tool_calls)) {
                for (const tc of parsed.tool_calls) {
                    if (tc.name && toolNames.has(tc.name)) {
                        calls.push({ name: tc.name, input: tc.input || {} });
                    }
                }
                if (calls.length > 0) return calls;
            }
        } catch { /* try next format */ }
    }

    // Format 2: [Calling tool "name" with input: {...}]
    const bracketPattern = /\[Calling tool "([^"]+)" with input:\s*(\{[\s\S]*?\})\]/g;
    let match;
    while ((match = bracketPattern.exec(text)) !== null) {
        const name = match[1];
        if (toolNames.has(name)) {
            try {
                const input = JSON.parse(match[2]);
                calls.push({ name, input });
            } catch { /* skip malformed */ }
        }
    }
    if (calls.length > 0) return calls;

    // Format 3: bare {"name":"known_tool","input":{...}}
    const barePattern = /\{"name"\s*:\s*"([^"]+)"\s*,\s*"input"\s*:\s*(\{[\s\S]*?\})\s*\}/g;
    while ((match = barePattern.exec(text)) !== null) {
        const name = match[1];
        if (toolNames.has(name)) {
            try {
                const input = JSON.parse(match[2]);
                calls.push({ name, input });
            } catch { /* skip */ }
        }
    }

    return calls;
}

function cliResultToApiResponse(cliResult, model, tools) {
    if (cliResult.is_error) {
        return {
            statusCode: 500,
            body: JSON.stringify({
                type: "error",
                error: { type: "api_error", message: cliResult.result || "CLI error" },
            }),
        };
    }

    const text = (cliResult.result || "").trim();
    let content;
    let stopReason = "end_turn";

    // Try to parse tool calls from text
    if (tools?.length) {
        const toolNames = new Set(tools.map((t) => t.name));
        const recovered = recoverToolCalls(text, toolNames);
        if (recovered.length > 0) {
            content = recovered.map((tc) => ({
                type: "tool_use",
                id: `toolu_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
                name: tc.name,
                input: tc.input || {},
            }));
            stopReason = "tool_use";
        }
    }

    if (!content) {
        content = [{ type: "text", text }];
    }

    const usage = cliResult.usage || {};
    return {
        statusCode: 200,
        body: JSON.stringify({
            id: `msg_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
            type: "message",
            role: "assistant",
            model,
            content,
            stop_reason: stopReason,
            stop_sequence: null,
            usage: {
                input_tokens: usage.input_tokens || 0,
                output_tokens: usage.output_tokens || 0,
                cache_creation_input_tokens: usage.cache_creation_input_tokens || 0,
                cache_read_input_tokens: usage.cache_read_input_tokens || 0,
            },
        }),
    };
}

function wrapAsSSE(jsonBody) {
    const response = JSON.parse(jsonBody);
    const { content, ...responseMeta } = response;
    let sse = "";

    // message_start
    sse += `event: message_start\ndata: ${JSON.stringify({
        type: "message_start",
        message: { ...response, content: [] },
    })}\n\n`;

    // content blocks
    for (let i = 0; i < content.length; i++) {
        const block = content[i];
        sse += `event: content_block_start\ndata: ${JSON.stringify({
            type: "content_block_start", index: i,
            content_block: block.type === "text"
                ? { type: "text", text: "" }
                : { type: "tool_use", id: block.id, name: block.name, input: {} },
        })}\n\n`;

        if (block.type === "text") {
            sse += `event: content_block_delta\ndata: ${JSON.stringify({
                type: "content_block_delta", index: i,
                delta: { type: "text_delta", text: block.text },
            })}\n\n`;
        } else if (block.type === "tool_use") {
            sse += `event: content_block_delta\ndata: ${JSON.stringify({
                type: "content_block_delta", index: i,
                delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) },
            })}\n\n`;
        }

        sse += `event: content_block_stop\ndata: ${JSON.stringify({
            type: "content_block_stop", index: i,
        })}\n\n`;
    }

    // message_delta + stop
    sse += `event: message_delta\ndata: ${JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: response.stop_reason, stop_sequence: null },
        usage: { output_tokens: response.usage?.output_tokens || 0 },
    })}\n\n`;
    sse += `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`;

    return sse;
}

// ── Request handler ─────────────────────────────────────────

async function handleMessages(req, res) {
    let body = "";
    for await (const chunk of req) body += chunk;

    let request;
    try {
        request = JSON.parse(body);
    } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { type: "invalid_request_error", message: "Invalid JSON" } }));
        return;
    }

    const { model, messages, system, stream, tools } = request;
    console.log(
        `[proxy] ${new Date().toISOString()} model=${model} msgs=${messages?.length} tools=${tools?.length || 0} stream=${!!stream}`
    );

    // ── Strategy 1: Direct API (works with API keys, and with OAuth for some models) ──
    const directResult = await forwardToAnthropic(body, res, !!stream);

    // Check if direct API worked
    if (directResult.statusCode === 200 || directResult.statusCode === 201) {
        console.log(`[proxy] Direct API success`);
        const ct = directResult.headers["content-type"] || "application/json";
        const fwdHeaders = { "content-type": ct };
        if (stream) {
            fwdHeaders["cache-control"] = "no-cache";
            fwdHeaders["connection"] = "keep-alive";
        }
        res.writeHead(directResult.statusCode, fwdHeaders);
        res.end(directResult.body);
        return;
    }

    // If it's a real validation error (not the generic "Error"), forward it
    try {
        const errBody = JSON.parse(directResult.body);
        const errMsg = errBody?.error?.message || "";
        if (directResult.statusCode === 400 && errMsg !== "Error") {
            // Real validation error — forward as-is
            res.writeHead(directResult.statusCode, { "content-type": "application/json" });
            res.end(directResult.body);
            return;
        }
    } catch { /* not JSON, fall through */ }

    // ── Strategy 2: Claude CLI fallback (for premium models via subscription) ──
    console.log(`[proxy] Direct API failed (${directResult.statusCode}), falling back to claude --print`);

    try {
        // Build system prompt
        let systemPrompt = typeof system === "string" ? system : "";
        if (Array.isArray(system)) {
            systemPrompt = system.map((s) => s.text || "").join("\n");
        }
        systemPrompt = buildToolSystemPrompt(systemPrompt, tools);

        const prompt = flattenMessages(messages);
        const cliResult = await runClaudeCLI(model, systemPrompt, prompt);
        const apiResponse = cliResultToApiResponse(cliResult, model, tools);

        console.log(`[proxy] CLI fallback: ${apiResponse.statusCode === 200 ? "success" : "error"}`);

        if (stream && apiResponse.statusCode === 200) {
            res.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            });
            res.end(wrapAsSSE(apiResponse.body));
        } else {
            res.writeHead(apiResponse.statusCode, { "Content-Type": "application/json" });
            res.end(apiResponse.body);
        }
    } catch (err) {
        console.error("[proxy] CLI fallback error:", err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
            type: "error",
            error: { type: "api_error", message: err.message },
        }));
    }
}

// ── HTTP Server ─────────────────────────────────────────────

const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers",
        "Content-Type, x-api-key, Authorization, anthropic-version, anthropic-beta");

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.method === "POST" && req.url === "/v1/messages") {
        await handleMessages(req, res);
        return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found. Use POST /v1/messages" }));
});

server.listen(PORT, () => {
    console.log(`Claude CLI Proxy listening on http://localhost:${PORT}`);
    console.log(`Strategy: Direct API → Claude CLI fallback`);
    console.log(`Point your backend at: CLAUDE_CLI_PROXY_URL=http://host.docker.internal:${PORT}`);
});
