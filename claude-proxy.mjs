#!/usr/bin/env node
/**
 * Claude CLI Proxy — translates Anthropic Messages API requests into
 * `claude --print` CLI calls, giving access to all Claude models via
 * a Claude Code subscription.
 *
 * Run on the HOST (not in Docker):
 *   node claude-proxy.mjs
 *
 * Then set in .env:
 *   CLAUDE_CLI_PROXY_URL=http://host.docker.internal:4005
 */

import { createServer } from "node:http";
import { spawn, execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const PORT = parseInt(process.env.CLAUDE_PROXY_PORT || "4006", 10);

// Resolve full path to `claude` binary so it works under systemd
const CLAUDE_BIN = process.env.CLAUDE_BIN || (() => {
    try {
        return execSync("which claude", { encoding: "utf-8" }).trim();
    } catch {
        return "claude"; // fallback, hope it's in PATH
    }
})();

console.log(`Claude binary: ${CLAUDE_BIN}`);

/**
 * Flatten Anthropic Messages API messages into a text prompt for the CLI.
 * Handles multi-turn, tool_use, and tool_result messages.
 */
function flattenMessages(messages) {
    const parts = [];
    for (const msg of messages) {
        if (typeof msg.content === "string") {
            parts.push(`${msg.role === "user" ? "Human" : "Assistant"}: ${msg.content}`);
            continue;
        }
        // content is an array of blocks
        const textParts = [];
        for (const block of msg.content) {
            if (block.type === "text") {
                textParts.push(block.text);
            } else if (block.type === "tool_use") {
                textParts.push(
                    `[Calling tool "${block.name}" with input: ${JSON.stringify(block.input)}]`
                );
            } else if (block.type === "tool_result") {
                const resultText =
                    typeof block.content === "string"
                        ? block.content
                        : block.content
                              ?.map((c) => c.text || JSON.stringify(c))
                              .join("\n") || "";
                textParts.push(`[Tool "${block.tool_use_id}" returned: ${resultText}]`);
            }
        }
        if (textParts.length > 0) {
            parts.push(
                `${msg.role === "user" ? "Human" : "Assistant"}: ${textParts.join("\n")}`
            );
        }
    }
    return parts.join("\n\n");
}

/**
 * Run `claude --print` and return the result.
 */
function runClaude(model, systemPrompt, prompt, stream) {
    return new Promise((resolve, reject) => {
        const args = [
            "--print",
            "--model", model,
            "--output-format", "json",
            "--no-session-persistence",
            "--tools", "",
        ];

        if (systemPrompt) {
            args.push("--system-prompt", systemPrompt);
        }

        const child = spawn(CLAUDE_BIN, args, {
            stdio: ["pipe", "pipe", "pipe"],
            env: { ...process.env, PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin" },
        });

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (d) => (stdout += d));
        child.stderr.on("data", (d) => (stderr += d));

        child.stdin.write(prompt);
        child.stdin.end();

        child.on("close", (code) => {
            if (code !== 0 && !stdout) {
                reject(new Error(`claude exited with code ${code}: ${stderr}`));
                return;
            }
            try {
                const result = JSON.parse(stdout);
                resolve(result);
            } catch {
                // Sometimes output isn't valid JSON
                resolve({ result: stdout, is_error: false });
            }
        });

        child.on("error", reject);
    });
}

/**
 * Handle POST /v1/messages
 */
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
        `[proxy] ${new Date().toISOString()} model=${model} messages=${messages?.length} tools=${tools?.length || 0} stream=${!!stream}`
    );

    // Build system prompt — include tool definitions if present
    let systemPrompt = typeof system === "string" ? system : "";
    if (Array.isArray(system)) {
        systemPrompt = system.map((s) => s.text || "").join("\n");
    }

    if (tools?.length > 0) {
        const toolDefs = tools
            .map(
                (t) =>
                    `<tool name="${t.name}">\n<description>${t.description || ""}</description>\n<parameters>${JSON.stringify(t.input_schema || {})}</parameters>\n</tool>`
            )
            .join("\n");

        systemPrompt += `\n\n<available_tools>\n${toolDefs}\n</available_tools>\n\nWhen you need to use a tool, respond with ONLY a JSON object in this exact format (no other text):\n{"tool_calls":[{"name":"tool_name","input":{...}}]}\n\nWhen you don't need a tool, respond normally with text.`;
    }

    const prompt = flattenMessages(messages);

    try {
        const cliResult = await runClaude(model, systemPrompt, prompt, stream);

        if (cliResult.is_error) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(
                JSON.stringify({
                    type: "error",
                    error: { type: "api_error", message: cliResult.result || "CLI error" },
                })
            );
            return;
        }

        // Check if the response is a tool call
        const text = (cliResult.result || "").trim();
        let content;
        let stopReason = "end_turn";

        try {
            const parsed = JSON.parse(text);
            if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
                content = parsed.tool_calls.map((tc) => ({
                    type: "tool_use",
                    id: `toolu_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
                    name: tc.name,
                    input: tc.input || {},
                }));
                stopReason = "tool_use";
            }
        } catch {
            // Not JSON — treat as plain text
        }

        if (!content) {
            content = [{ type: "text", text }];
        }

        const usage = cliResult.usage || {};
        const response = {
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
        };

        console.log(`[proxy] Response: stop_reason=${stopReason} content_blocks=${content.length}`);

        if (stream) {
            // For streaming, wrap in SSE format that the Anthropic SDK expects
            res.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
            });

            // message_start
            res.write(`event: message_start\ndata: ${JSON.stringify({
                type: "message_start",
                message: { ...response, content: [] },
            })}\n\n`);

            // Send each content block
            for (let i = 0; i < content.length; i++) {
                const block = content[i];
                res.write(`event: content_block_start\ndata: ${JSON.stringify({
                    type: "content_block_start",
                    index: i,
                    content_block: block.type === "text"
                        ? { type: "text", text: "" }
                        : { type: "tool_use", id: block.id, name: block.name, input: {} },
                })}\n\n`);

                if (block.type === "text") {
                    res.write(`event: content_block_delta\ndata: ${JSON.stringify({
                        type: "content_block_delta",
                        index: i,
                        delta: { type: "text_delta", text: block.text },
                    })}\n\n`);
                } else if (block.type === "tool_use") {
                    res.write(`event: content_block_delta\ndata: ${JSON.stringify({
                        type: "content_block_delta",
                        index: i,
                        delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) },
                    })}\n\n`);
                }

                res.write(`event: content_block_stop\ndata: ${JSON.stringify({
                    type: "content_block_stop",
                    index: i,
                })}\n\n`);
            }

            // message_delta + message_stop
            res.write(`event: message_delta\ndata: ${JSON.stringify({
                type: "message_delta",
                delta: { stop_reason: stopReason, stop_sequence: null },
                usage: { output_tokens: usage.output_tokens || 0 },
            })}\n\n`);

            res.write(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);
            res.end();
        } else {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(response));
        }
    } catch (err) {
        console.error("[proxy] Error:", err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
            JSON.stringify({
                type: "error",
                error: { type: "api_error", message: err.message },
            })
        );
    }
}

// ── Server ────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key, Authorization, anthropic-version, anthropic-beta");

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
    console.log(`Point your backend at: CLAUDE_CLI_PROXY_URL=http://host.docker.internal:${PORT}`);
});
