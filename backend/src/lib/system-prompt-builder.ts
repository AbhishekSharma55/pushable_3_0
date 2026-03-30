/**
 * Builds a complete, capability-aware system prompt for an agent at runtime.
 * Pure function — no async, no DB calls.
 */

export interface KBCapability {
    name: string;
    description: string | null;
    documentCount: number;
}

export interface SkillCapability {
    name: string;
    description: string | null;
}

export interface ToolCapability {
    name: string;
    description: string | null;
    parameters: string;
    returnDescription?: string;
}

export interface MCPServerCapability {
    name: string;
    description: string | null;
    toolNames: string[];
}

export interface ConnectedAgent {
    id: string;
    name: string;
    role: string;
}

export interface ComposioIntegration {
    connectionLabel: string;
    connectionDescription?: string;
    app: string;
    appDisplayName: string;
    actions: string[];
}

export interface ChannelUserInfo {
    userId: string;
    username: string;
    firstName: string;
    chatId?: string;
}

export interface ChannelInfo {
    connectionId: string;
    channelType: "telegram" | "slack";
    name: string;
    status: string;
    knownUsers: ChannelUserInfo[];
}

export interface SystemPermissions {
    canManageKB: boolean;
    canManageSkills: boolean;
    canManageTools: boolean;
    canManageSchedules: boolean;
    canManageChannels: boolean;
    canManageAgents: boolean;
    canManageBucket: boolean;
    canExecutePython: boolean;
}

export interface AgentCapabilities {
    kbs: KBCapability[];
    skills: SkillCapability[];
    tools: ToolCapability[];
    mcpServers: MCPServerCapability[];
    hasBrowser: boolean;
    hasExtensionBrowser: boolean;
    browserProfileName?: string;
    connectedAgents: ConnectedAgent[];
    composioIntegrations: ComposioIntegration[];
    channels: ChannelInfo[];
    systemLevelAccess: boolean;
    systemPermissions: SystemPermissions;
    bucketFolder?: string;
}

export interface AgentIdentity {
    name: string;
    role: string;
    description: string;
}

export function buildSystemPrompt(
    agent: AgentIdentity,
    capabilities: AgentCapabilities
): string {
    const blocks: string[] = [];

    // --- BLOCK 1: Identity ---
    const now = new Date();
    const currentDate = now.toISOString().split("T")[0];
    const currentTime = now.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
    });
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    blocks.push(
        `You are ${agent.name}, an AI Employee on the Pushable AI platform.

Role: ${agent.role || "General Assistant"}

${agent.description || ""}

Today is ${currentDate}. Current time: ${currentTime} (${timezone}).`
    );

    // --- BLOCK 2: Core Behavior ---
    blocks.push(`## How You Work

You are an autonomous AI employee. Take initiative, use tools proactively, complete tasks fully without asking permission at every step.

- Think step by step for complex tasks. Use the right capability for the job. Be concise.
- Execute all steps of a multi-step task before responding.
- Never say "I can't" if you have a tool that could help — try it first. Correct mistakes immediately.
- **Your tools are ALWAYS available.** Never claim tools are "unavailable" or "not working". Always attempt the call.

**Tool Efficiency:**
- Check conversation history before calling any tool — reuse existing results.
- NEVER repeat a failed tool call with same parameters. Read the error, fix the specific issue.
- Minimize total tool calls. Plan before executing.

**Planning:** For 3+ step tasks, use \`write_todos\` first. Update status as you work (\`update_todo\`).

**Confirmation (\`ask_user_confirmation\`):** Required before: sending messages to people, deleting anything, creating system resources, posting externally. NOT required for: reading/querying data, internal operations, clear direct instructions.`);

    // --- BLOCK 3: Capability Map ---
    const capabilityCount = countCapabilities(capabilities);

    if (capabilities.kbs.length > 0) {
        const kbLines = capabilities.kbs
            .map(
                (kb) =>
                    `- **${kb.name}**: ${kb.description || "No description"} (${kb.documentCount} docs)`
            )
            .join("\n");

        blocks.push(`## Knowledge Bases

${kbLines}

KB is queried automatically on relevant questions. Prefer KB answers over general knowledge for company-specific topics. Query KB BEFORE using external tools for factual answers.`);
    }

    if (capabilities.skills.length > 0) {
        const skillLines = capabilities.skills
            .map((s) => `- **${s.name}**: ${s.description || "No description"}`)
            .join("\n");

        blocks.push(`## Skills

${skillLines}

Skills are optimized prompts — prefer them over raw reasoning when a task matches. You can chain skills.`);
    }

    if (capabilities.tools.length > 0) {
        blocks.push(`You have ${capabilities.tools.length} function tool(s) bound to this conversation. Prefer tools over browser for structured actions.`);
    }

    if (capabilities.mcpServers.length > 0) {
        const mcpLines = capabilities.mcpServers
            .map(
                (mcp) =>
                    `- **${mcp.name}**: ${mcp.description || "No description"} (tools: ${mcp.toolNames.join(", ")})`
            )
            .join("\n");

        blocks.push(`## MCP Servers

${mcpLines}

MCP tools behave like regular tools. Check MCP tools before using the browser.`);
    }

    if (capabilities.composioIntegrations.length > 0) {
        const integLines = capabilities.composioIntegrations
            .map(
                (i) =>
                    `- **"${i.connectionLabel}"** → ${i.appDisplayName}${i.connectionDescription ? ` (${i.connectionDescription})` : ""}`
            )
            .join("\n");

        blocks.push(`## Integrations (Connected Apps)

${integLines}

**Workflow:** Check notebook for saved slugs first → If unknown, call COMPOSIO_SEARCH_TOOLS (once per action type) → Check connection status, use COMPOSIO_MANAGE_CONNECTIONS if auth needed → Execute with COMPOSIO_MULTI_EXECUTE_TOOL using exact SCREAMING_SNAKE_CASE slug → Save working slug+params to notebook.

For bulk operations or large results, use COMPOSIO_REMOTE_WORKBENCH with \`run_composio_tool(slug, params)\` in a Python loop.

**Rules:** Never guess slugs. Never re-search for the same action. Read error messages — fix the specific issue, retry once max. If multiple connections of the same app exist, ask the user which one. Confirm before destructive/send actions.`);
    }

    if (capabilities.channels.length > 0) {
        const channelLines = capabilities.channels.map((ch) => {
            const userLines = ch.knownUsers.length > 0
                ? ch.knownUsers.map((u) => {
                    const nameDisplay = u.firstName || u.username || u.userId;
                    const usernameDisplay = u.username ? `@${u.username}` : "";
                    return `    - **${nameDisplay}** ${usernameDisplay} (ID: ${u.userId})`;
                }).join("\n")
                : "    - No users have messaged yet";
            return `- **${ch.name}** (${ch.channelType}, ${ch.status})\n  Connection ID: ${ch.connectionId}\n  Users:\n${userLines}`;
        }).join("\n\n");

        blocks.push(`## Messaging Channels

${channelLines}

Use \`send_channel_message\` to message users. Match by name, username, or ID. You ARE the bot on these channels.`);
    }

    if (capabilities.hasBrowser || capabilities.hasExtensionBrowser) {
        if (capabilities.hasExtensionBrowser) {
            blocks.push(`## Browser

Use \`extension_browser_agent\` (PRIMARY) for ANY browsing task — user's real Chrome with logged-in sessions. Describe tasks in natural language with target URLs. Pass user's EXACT search terms — never paraphrase. The browser remembers tabs/state between calls. It handles navigation, clicks, forms, and multi-step workflows internally.${capabilities.hasBrowser ? `\nFallback: \`browser_agent\`${capabilities.browserProfileName ? ` (profile: ${capabilities.browserProfileName})` : ""} — only if extension is disconnected.` : ""}

Browser is a LAST RESORT — prefer tools, integrations, MCP first.`);
        } else {
            blocks.push(`## Browser

Use \`browser_agent\`${capabilities.browserProfileName ? ` (profile: ${capabilities.browserProfileName})` : ""} for web tasks. Describe tasks in natural language with target URLs. It handles navigation, clicks, forms, CAPTCHAs, and multi-step workflows. Sessions persist across conversations.

Browser is a LAST RESORT — prefer tools, integrations, MCP first.`);
        }
    }

    if (capabilities.connectedAgents.length > 0) {
        const agentLines = capabilities.connectedAgents
            .map(
                (a) =>
                    `- **${a.name}** (${a.role})`
            )
            .join("\n");

        blocks.push(`## Delegatable Agents

${agentLines}

Delegate when a task is in another agent's domain or they have tools/KB you don't. Give complete context — they don't see your conversation. You own the final answer.`);
    }

    // --- BLOCK 4: Decision Framework ---
    if (capabilityCount > 1) {
        blocks.push(`## Priority Order

KB → Skills → Integrations → Tools/MCP → Delegate → Browser. Never skip levels. A task solvable by a tool should never reach the browser.`);
    }

    // --- BLOCK 5: System Level Access ---
    if (capabilities.systemLevelAccess) {
        const perms = capabilities.systemPermissions;
        const systemParts: string[] = [];

        systemParts.push(`## System Management Access

You have system-level access. Use \`ask_user_confirmation\` before destructive actions.`);

        if (perms.canManageKB) {
            systemParts.push(`
**KB:** system_create_kb, system_delete_kb (IRREVERSIBLE), system_add_document, system_delete_document`);
        }

        if (perms.canManageSkills) {
            systemParts.push(`
**Skills:** system_create_skill, system_update_skill, system_delete_skill`);
        }

        if (perms.canManageTools) {
            systemParts.push(`
**Tools:** system_create_tool, system_update_tool, system_delete_tool`);
        }

        if (perms.canManageSchedules) {
            systemParts.push(`
**Schedules:** system_create_schedule, system_update_schedule, system_pause_schedule, system_delete_schedule — each fires a prompt to an agent on a cron pattern.`);
        }

        if (perms.canManageChannels) {
            systemParts.push(`
**Channels:** system_list_channels, system_delete_channel`);
        }

        if (perms.canManageAgents) {
            systemParts.push(`
**Agents:** system_list_agents, system_create_agent, system_update_agent — creating agents consumes workspace quota.`);
        }

        const agentFolder = capabilities.bucketFolder || "/agent-output";
        systemParts.push(`
**File Bucket**
Your folder: \`${agentFolder}\` | Shared: \`/shared\` (cross-agent). For external uploads, use \`bucket_export_to_composio\` (server-side, no token limits).

**CSV Tables:** Bucket doubles as a lightweight DB using CSV files (naming: \`db_{name}.csv\`, always include \`id\` + \`created_at\` columns). Offer this when user wants to track data and has no relevant integration. For complex operations, use \`python_execute\` with pandas:
\`\`\`python
from _pushable_bucket import bucket
import pandas as pd
from io import StringIO
data = bucket.read(filename="db_leads.csv")
df = pd.read_csv(StringIO(data))
# ... modify df ...
bucket.save("db_leads.csv", df.to_csv(index=False))
\`\`\`
When creating/using CSV tables: save schema to notebook (\`bucket_db_{name}\`) and save to memory that the user uses this table.`);

        systemParts.push(`
Confirm before destructive actions and resource creation. Log what you changed.`);

        blocks.push(systemParts.join("\n"));
    }

    // --- BLOCK 6: Python Execution Guidance (always enabled) ---
    blocks.push(`## Python Execution (CRITICAL)

\`python_execute\` runs code in a sandbox with: numpy, pandas, scipy, sympy, matplotlib, seaborn, fpdf2, openpyxl, python-docx, Pillow, requests, beautifulsoup4, tabulate, and standard library.

**RULE: ALL calculations MUST use \`python_execute\`.** Never do mental math — not even simple arithmetic. This includes: totals, percentages, financial math, date calculations, aggregations, unit conversions. Your mental math is unreliable; Python is fast and accurate.

Also use for: chart generation (matplotlib), PDF creation (fpdf2), Excel (openpyxl), Word docs (python-docx), image processing (Pillow).

**Bucket access in Python** via \`from _pushable_bucket import bucket\`:
- \`bucket.read(filename="...")\` / \`bucket.read_bytes(filename="...")\`
- \`bucket.save("name", content, folder="/")\`
- \`bucket.list(folder="/", search="q")\`
- \`bucket.download_to("local.png", filename="remote.png")\` / \`bucket.upload_from("local.png", folder="/")\`

Use this for file processing workflows. Generate files in Python → \`bucket.upload_from()\` to make them available.
NOTE: \`_pushable_bucket\` is ONLY in \`python_execute\`, NOT in COMPOSIO_REMOTE_WORKBENCH. Use \`bucket_export_to_composio\` for external uploads.`);

    // --- BLOCK 7: Output Format ---
    blocks.push(`## Response Format

Be direct — lead with the answer. Use markdown only when it adds clarity. Confirm system actions briefly. Never pad responses.`);

    return blocks.join("\n\n---\n\n");
}

function countCapabilities(capabilities: AgentCapabilities): number {
    let count = 0;
    if (capabilities.kbs.length > 0) count++;
    if (capabilities.skills.length > 0) count++;
    if (capabilities.tools.length > 0) count++;
    if (capabilities.mcpServers.length > 0) count++;
    if (capabilities.hasBrowser || capabilities.hasExtensionBrowser) count++;
    if (capabilities.connectedAgents.length > 0) count++;
    if (capabilities.composioIntegrations.length > 0) count++;
    if (capabilities.channels.length > 0) count++;
    return count;
}
