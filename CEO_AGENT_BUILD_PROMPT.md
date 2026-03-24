# CEO Agent + Projects System — Full Implementation Prompt

> **Context**: This is a continuation prompt for building the CEO Agent + Projects intelligence layer for Pushable AI. All architecture decisions were discussed and finalized. This prompt contains everything needed to one-shot the implementation.

---

## What is Pushable AI (Current State)

Pushable AI is a platform where users "Deploy, manage, and orchestrate AI agents as employees." Currently it's a **configurable tool** — users manually create agents, write system prompts, attach integrations, set up schedules, and define everything. The system executes but doesn't think.

### Current Tech Stack
- **Frontend**: Next.js 16 (React 19), TypeScript, Tailwind CSS 4, shadcn/ui
- **Backend**: Fastify 5, TypeScript, LangChain + LangGraph, PostgreSQL + pgvector, Drizzle ORM, BullMQ + Redis, Zod
- **AI**: Claude API (Anthropic gateway), OpenRouter (fallback), Composio (100+ integrations)
- **Architecture pattern**: Routes → Services → Repositories → Drizzle DB

### Current Features
- Agent CRUD with system prompts, model selection, temperature
- Session-based chat with SSE streaming
- Tool execution (MCP, webhooks, browser, Composio integrations)
- Agent-to-agent delegation
- Knowledge bases with semantic search (pgvector embeddings)
- Scheduling (natural language → cron, BullMQ workers)
- HITL approvals via Telegram/Slack
- Browser automation (navigate, click, scrape, fill forms, CAPTCHA solving)
- Skills system (reusable instruction sets)
- Planning tools (write_todos, update_todo, get_todos)
- Memory system (per-user agent memories)
- Credit-based billing
- Multi-tenant workspaces

---

## What We're Building

An **intelligence layer** that transforms Pushable from a configurable tool into an autonomous system. The user talks to one CEO agent in natural language, and the CEO manages everything — creates projects, spins up agents, sets schedules, monitors performance, and adapts strategy.

### The Vision
```
User: "Find leads in LA targeting dental doctors"

CEO: Asks smart clarifying questions (only if needed — if the request is clear, just proceed)
CEO: Creates a project "Dental Doctors - LA"
CEO: Creates milestones, KB, agents, schedules
Workers: Execute daily — scrape, outreach, etc.
Workers: Write run reports after every execution
User: "How's it going?"
CEO: Reads all run reports since last check-in → updates memory → responds with status
CEO: Evaluates milestones, adjusts strategy if needed
```

---

## Architecture Decisions (All Finalized)

### CEO Agent
1. **One CEO per workspace** — auto-created when workspace is created
2. **Uses existing chat interface** — no separate UI needed
3. **CEO can create agents on its own** — full system control
4. **On-demand interaction** — user asks "how's it going?", CEO reviews. Heartbeat (auto-review cycle) comes in a future version
5. **CEO has direct system control** — can change agent prompts, schedules, integrations, create/delete agents
6. **CEO uses Opus-tier model** — workers use Sonnet/Haiku for cost efficiency
7. **Two tiers for now**: CEO + Workers. Roles/managers come later

### Projects
8. **Projects are the organizational unit** between Workspace and Agents
9. **Agents can belong to multiple projects** — like real employees
10. **Project-level KB** — assign existing workspace KBs to projects (reuse existing KB system)
11. **Milestones** — both user-defined and CEO-proposed. CEO auto-evaluates milestone completion based on run reports
12. **Project has instructions** — shared context for all agents in that project

### Run Reports
13. **System-level enforcement** — after every scheduled run, the system automatically forces the agent to write a structured run report as the final step in the graph execution. Not just a prompt instruction — built into the agent graph
14. **Structured `runReports` table** — not just session messages. CEO reads these, not raw conversations
15. **CEO does NOT read agent session messages** — only run reports. Reading sessions would cause hallucination

### CEO State & Memory
16. **CEO reads all run reports from project agents since last check-in** when user asks for status
17. **CEO updates its own memory** after reviewing reports — so it remembers decisions and context across conversations

### Data Storage
18. **CEO decides data structure** for project KB data — flexible storage
19. **Available to everyone** — no feature flag or plan tier restriction

---

## Database Schema Changes

### New Tables to Create

#### 1. `projects` table
```sql
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    instructions TEXT,  -- shared context for all agents in this project
    status TEXT NOT NULL DEFAULT 'active',  -- active, paused, completed, archived
    created_by UUID REFERENCES agents(id) ON DELETE SET NULL,  -- which agent (CEO) created it
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

#### 2. `project_milestones` table
```sql
CREATE TABLE project_milestones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'not_started',  -- not_started, in_progress, completed, blocked
    target_date TIMESTAMP,  -- optional deadline
    completed_at TIMESTAMP,
    evaluation_notes TEXT,  -- CEO's notes on why milestone status changed
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

#### 3. `project_agents` table (many-to-many link)
```sql
CREATE TABLE project_agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    role_in_project TEXT,  -- optional: what this agent does in this project (e.g., "lead finder", "email outreach")
    assigned_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(project_id, agent_id)
);
```

#### 4. `project_knowledge_bases` table (link projects to existing KBs)
```sql
CREATE TABLE project_knowledge_bases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kb_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(project_id, kb_id)
);
```

#### 5. `run_reports` table
```sql
CREATE TABLE run_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,  -- nullable: agent might not be in a project
    session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    schedule_id UUID REFERENCES schedules(id) ON DELETE SET NULL,
    summary TEXT NOT NULL,  -- agent's own summary of what it did
    actions_taken TEXT,  -- what actions were performed
    outcomes TEXT,  -- what happened as a result
    issues TEXT,  -- any problems encountered
    metrics JSONB DEFAULT '{}',  -- flexible key-value metrics (agent decides structure)
    data JSONB DEFAULT '{}',  -- any structured data the agent wants to store
    run_type TEXT NOT NULL DEFAULT 'scheduled',  -- scheduled, on_demand, ceo_triggered
    started_at TIMESTAMP NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### Modifications to Existing Tables

#### `agents` table — add `is_ceo` and `agent_type` columns
```sql
ALTER TABLE agents ADD COLUMN is_ceo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE agents ADD COLUMN agent_type TEXT NOT NULL DEFAULT 'worker';  -- 'ceo' or 'worker'
```

#### `schedules` table — add optional `project_id`
```sql
ALTER TABLE schedules ADD COLUMN project_id UUID REFERENCES projects(id) ON DELETE SET NULL;
```

---

## Drizzle Schema Files to Create/Modify

### Create: `backend/src/db/schema/projects.ts`
```typescript
import { pgTable, text, timestamp, uuid, integer } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";
import { agents } from "./agents.ts";

export const projects = pgTable("projects", {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    instructions: text("instructions"),
    status: text("status").notNull().default("active"),
    createdBy: uuid("created_by").references(() => agents.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

### Create: `backend/src/db/schema/projectMilestones.ts`
```typescript
import { pgTable, text, timestamp, uuid, integer } from "drizzle-orm/pg-core";
import { projects } from "./projects.ts";
import { workspaces } from "./workspaces.ts";

export const projectMilestones = pgTable("project_milestones", {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
        .notNull()
        .references(() => projects.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("not_started"),
    targetDate: timestamp("target_date"),
    completedAt: timestamp("completed_at"),
    evaluationNotes: text("evaluation_notes"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

### Create: `backend/src/db/schema/projectAgents.ts`
```typescript
import { pgTable, text, timestamp, uuid, unique } from "drizzle-orm/pg-core";
import { projects } from "./projects.ts";
import { agents } from "./agents.ts";
import { workspaces } from "./workspaces.ts";

export const projectAgents = pgTable("project_agents", {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
        .notNull()
        .references(() => projects.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
        .notNull()
        .references(() => agents.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    roleInProject: text("role_in_project"),
    assignedAt: timestamp("assigned_at").defaultNow().notNull(),
}, (table) => ({
    uniqueProjectAgent: unique().on(table.projectId, table.agentId),
}));
```

### Create: `backend/src/db/schema/projectKnowledgeBases.ts`
```typescript
import { pgTable, timestamp, uuid, unique } from "drizzle-orm/pg-core";
import { projects } from "./projects.ts";
import { knowledgeBases } from "./knowledgeBases.ts";
import { workspaces } from "./workspaces.ts";

export const projectKnowledgeBases = pgTable("project_knowledge_bases", {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
        .notNull()
        .references(() => projects.id, { onDelete: "cascade" }),
    kbId: uuid("kb_id")
        .notNull()
        .references(() => knowledgeBases.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at").defaultNow().notNull(),
}, (table) => ({
    uniqueProjectKb: unique().on(table.projectId, table.kbId),
}));
```

### Create: `backend/src/db/schema/runReports.ts`
```typescript
import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";
import { agents } from "./agents.ts";
import { projects } from "./projects.ts";
import { sessions } from "./sessions.ts";
import { schedules } from "./schedules.ts";

export const runReports = pgTable("run_reports", {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
        .notNull()
        .references(() => agents.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
        .references(() => projects.id, { onDelete: "set null" }),
    sessionId: uuid("session_id")
        .references(() => sessions.id, { onDelete: "set null" }),
    scheduleId: uuid("schedule_id")
        .references(() => schedules.id, { onDelete: "set null" }),
    summary: text("summary").notNull(),
    actionsTaken: text("actions_taken"),
    outcomes: text("outcomes"),
    issues: text("issues"),
    metrics: jsonb("metrics").default({}).notNull(),
    data: jsonb("data").default({}).notNull(),
    runType: text("run_type").notNull().default("scheduled"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

### Modify: `backend/src/db/schema/agents.ts`
Add two new columns:
```typescript
isCeo: boolean("is_ceo").default(false).notNull(),
agentType: text("agent_type").default("worker").notNull(),  // 'ceo' or 'worker'
```

### Modify: `backend/src/db/schema/schedules.ts`
Add:
```typescript
projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
```

### Modify: `backend/src/db/schema/index.ts`
Add exports for all new tables:
```typescript
export { projects } from "./projects.ts";
export { projectMilestones } from "./projectMilestones.ts";
export { projectAgents } from "./projectAgents.ts";
export { projectKnowledgeBases } from "./projectKnowledgeBases.ts";
export { runReports } from "./runReports.ts";
```

---

## Backend Implementation

### 1. Repositories to Create

#### `backend/src/repositories/project.repository.ts`
CRUD operations for projects:
- `create(data, workspaceId)` — create project
- `findById(id, workspaceId)` — get single project
- `findByWorkspace(workspaceId)` — list all projects in workspace
- `update(id, workspaceId, data)` — update project
- `delete(id, workspaceId)` — delete project
- `assignAgent(projectId, agentId, workspaceId, roleInProject?)` — link agent to project
- `removeAgent(projectId, agentId, workspaceId)` — unlink agent
- `getAgents(projectId, workspaceId)` — get all agents in a project
- `getProjectsForAgent(agentId, workspaceId)` — get all projects an agent belongs to
- `assignKB(projectId, kbId, workspaceId)` — link KB to project
- `removeKB(projectId, kbId, workspaceId)` — unlink KB
- `getKBs(projectId, workspaceId)` — get all KBs for a project

#### `backend/src/repositories/milestone.repository.ts`
CRUD for milestones:
- `create(data, projectId, workspaceId)` — create milestone
- `findByProject(projectId, workspaceId)` — list milestones for a project
- `update(id, workspaceId, data)` — update milestone (status, notes, etc.)
- `delete(id, workspaceId)` — delete milestone

#### `backend/src/repositories/runReport.repository.ts`
CRUD for run reports:
- `create(data)` — create run report
- `findByProject(projectId, workspaceId, opts?)` — get reports for a project (with optional date filter)
- `findByAgent(agentId, workspaceId, opts?)` — get reports for an agent
- `findSinceDate(workspaceId, since, projectId?)` — get reports since a specific date (for CEO review)
- `findById(id, workspaceId)` — get single report

### 2. Services to Create

#### `backend/src/services/project.service.ts`
Business logic for projects. Mostly delegates to repository, but includes:
- Validation logic
- Cascading operations (e.g., when deleting a project, handle cleanup)

#### `backend/src/services/ceo.service.ts`
CEO-specific business logic:
- `getOrCreateCEO(workspaceId)` — finds existing CEO agent or creates one. Called during workspace creation and when accessing CEO
- `isCEO(agentId, workspaceId)` — check if an agent is the CEO
- CEO auto-creation config:
  ```typescript
  {
      name: "CEO",
      systemPrompt: CEO_SYSTEM_PROMPT,  // see CEO System Prompt section below
      model: "claude-sonnet-4-20250514",  // or whatever top model is configured (use opus when available)
      temperature: 0.7,
      isCeo: true,
      agentType: "ceo",
      systemLevelAccess: true,
      canManageKB: true,
      canManageSkills: true,
      canManageTools: true,
      canManageSchedules: true,
      canManageChannels: true,
      canManageAgents: true,
      requireApprovalForAll: false,  // CEO doesn't need user approval for system actions
  }
  ```

### 3. Routes to Create

#### `backend/src/routes/projects.ts`
REST API for projects:
- `GET /projects` — list all projects in workspace
- `GET /projects/:id` — get single project with milestones, agents, KBs
- `POST /projects` — create project (can also be done by CEO via tools)
- `PUT /projects/:id` — update project
- `DELETE /projects/:id` — delete project
- `POST /projects/:id/agents` — assign agent to project
- `DELETE /projects/:id/agents/:agentId` — remove agent from project
- `POST /projects/:id/milestones` — create milestone
- `PUT /projects/:id/milestones/:milestoneId` — update milestone
- `DELETE /projects/:id/milestones/:milestoneId` — delete milestone
- `POST /projects/:id/kb` — assign KB to project
- `DELETE /projects/:id/kb/:kbId` — remove KB from project
- `GET /projects/:id/reports` — get run reports for a project

#### `backend/src/routes/runReports.ts`
- `GET /run-reports` — list run reports (filterable by agent, project, date range)
- `GET /run-reports/:id` — get single run report

#### Modify `backend/src/routes/agents.ts`
- Add `GET /agents/ceo` — returns the workspace CEO agent (auto-creates if doesn't exist)
- Modify agent list to include `isCeo` and `agentType` fields

### 4. CEO Management Tools — `backend/src/tools/ceo.tools.ts`

These tools are ONLY given to the CEO agent. They extend beyond the existing system tools.

```typescript
export function buildCEOTools(config: { agentId: string; workspaceId: string }): DynamicStructuredTool[]
```

The CEO gets ALL existing system tools (since it has full system permissions) PLUS these additional CEO-specific tools:

#### Project Management Tools
- **`ceo_create_project`** — Create a new project
  - params: `name`, `description`, `instructions`
  - Creates project, assigns CEO as `createdBy`

- **`ceo_update_project`** — Update project details
  - params: `projectId`, `name?`, `description?`, `instructions?`, `status?`

- **`ceo_delete_project`** — Delete a project (requires name confirmation, like KB delete)
  - params: `projectId`, `confirmName`

- **`ceo_list_projects`** — List all projects with their status, agent count, milestone progress
  - params: none

- **`ceo_get_project_details`** — Get full project details including milestones, agents, KBs, recent reports
  - params: `projectId`

#### Milestone Management Tools
- **`ceo_create_milestone`** — Add milestone to a project
  - params: `projectId`, `title`, `description?`, `targetDate?`

- **`ceo_update_milestone`** — Update milestone status/details
  - params: `milestoneId`, `title?`, `description?`, `status?`, `evaluationNotes?`

- **`ceo_delete_milestone`** — Remove a milestone
  - params: `milestoneId`

- **`ceo_evaluate_milestones`** — Read recent run reports for a project and auto-evaluate milestone progress
  - params: `projectId`
  - This tool fetches all run reports since last evaluation, analyzes them, and updates milestone statuses with evaluation notes

#### Agent-Project Assignment Tools
- **`ceo_assign_agent_to_project`** — Add an agent to a project
  - params: `agentId`, `projectId`, `roleInProject?`

- **`ceo_remove_agent_from_project`** — Remove an agent from a project
  - params: `agentId`, `projectId`

#### KB-Project Assignment Tools
- **`ceo_assign_kb_to_project`** — Link a KB to a project
  - params: `kbId`, `projectId`

- **`ceo_remove_kb_from_project`** — Unlink a KB from a project
  - params: `kbId`, `projectId`

#### Run Report & Monitoring Tools
- **`ceo_get_project_reports`** — Get run reports for a project (with date filter)
  - params: `projectId`, `since?` (ISO date string, defaults to 24h ago)

- **`ceo_get_agent_reports`** — Get run reports for a specific agent
  - params: `agentId`, `since?`

#### Agent Instruction Tool
- **`ceo_message_agent`** — Send a direct instruction to an agent (triggers an on-demand run)
  - params: `agentId`, `message`
  - Creates a new session, invokes the agent graph with the message, returns the result
  - The run report from this execution will have `runType: "ceo_triggered"`

**IMPORTANT**: The CEO should NOT get browser tools, planning tools (write_todos/update_todo), or other execution-level tools. The CEO is a manager — it thinks and delegates, it doesn't execute. It gets: system tools + CEO tools + memory tools.

### 5. Run Report System — Modify Agent Graph

#### Modify `backend/src/processors/schedule.processor.ts`

After the agent graph completes a scheduled run, **automatically ask the agent to write a run report**:

```typescript
export async function processSchedule(data: {
    scheduleId: string;
    agentId: string;
    prompt: string;
    workspaceId: string;
}) {
    const { scheduleId, agentId, prompt, workspaceId } = data;

    // ... existing humanization check ...

    const startedAt = new Date();

    try {
        const graph = await createAgentGraph(agentId, workspaceId);

        // Execute the actual task
        const result = await graph.invoke(
            { messages: [new HumanMessage(prompt)] },
            { configurable: { thread_id: `schedule-${scheduleId}` } }
        );

        // Get the agent's response
        const messages = result.messages;
        const lastMsg = messages[messages.length - 1];
        const resultText = typeof lastMsg.content === "string"
            ? lastMsg.content
            : JSON.stringify(lastMsg.content);

        // NOW: Force the agent to write a run report
        const reportPrompt = `You just completed a scheduled task. Write a structured run report.

The task you were given: "${prompt}"

Your result: "${resultText.substring(0, 2000)}"

Now write a run report with these sections:
1. SUMMARY: One paragraph of what you did
2. ACTIONS TAKEN: Bullet list of specific actions
3. OUTCOMES: What was the result of each action
4. ISSUES: Any problems encountered (or "None")
5. METRICS: Any quantifiable results as key:value pairs (e.g., leads_found:15, emails_sent:10)

Format your response as JSON:
{
    "summary": "...",
    "actionsTaken": "...",
    "outcomes": "...",
    "issues": "...",
    "metrics": { "key": "value" }
}`;

        const reportResult = await graph.invoke(
            { messages: [new HumanMessage(reportPrompt)] },
            { configurable: { thread_id: `schedule-${scheduleId}-report` } }
        );

        const reportMsg = reportResult.messages[reportResult.messages.length - 1];
        const reportText = typeof reportMsg.content === "string"
            ? reportMsg.content
            : JSON.stringify(reportMsg.content);

        // Parse the report and save to DB
        let reportData;
        try {
            // Try to extract JSON from the response
            const jsonMatch = reportText.match(/\{[\s\S]*\}/);
            reportData = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
        } catch {
            reportData = null;
        }

        // Find which project this agent belongs to (if any)
        const agentProjects = await projectRepository.getProjectsForAgent(agentId, workspaceId);
        const projectId = agentProjects.length > 0 ? agentProjects[0].id : null;

        // Save the run report
        await runReportRepository.create({
            workspaceId,
            agentId,
            projectId,
            scheduleId,
            summary: reportData?.summary || resultText.substring(0, 500),
            actionsTaken: reportData?.actionsTaken || null,
            outcomes: reportData?.outcomes || null,
            issues: reportData?.issues || null,
            metrics: reportData?.metrics || {},
            data: {},
            runType: "scheduled",
            startedAt,
            completedAt: new Date(),
        });

        // Update last run timestamp
        await scheduleRepository.updateLastRunAt(scheduleId);

        logger.info({ scheduleId, resultLength: resultText.length }, "Scheduled prompt completed with run report");
    } catch (error) {
        // ... existing error handling ...
        // Also save a failed run report
        const agentProjects = await projectRepository.getProjectsForAgent(agentId, workspaceId);
        await runReportRepository.create({
            workspaceId,
            agentId,
            projectId: agentProjects.length > 0 ? agentProjects[0].id : null,
            scheduleId,
            summary: `Scheduled run failed: ${error instanceof Error ? error.message : "Unknown error"}`,
            actionsTaken: null,
            outcomes: null,
            issues: error instanceof Error ? error.message : "Unknown error",
            metrics: {},
            data: {},
            runType: "scheduled",
            startedAt,
            completedAt: new Date(),
        });
    }
}
```

### 6. CEO System Prompt

The CEO agent needs a special system prompt. This is NOT the regular `buildSystemPrompt()` — the CEO gets a custom prompt that tells it how to behave as a CEO.

Store this in `backend/src/lib/ceo-prompt.ts`:

```typescript
export const CEO_SYSTEM_PROMPT = `You are the CEO — the central intelligence of this workspace on Pushable AI.

## Your Role
You are NOT a regular agent. You are the strategic brain that manages all projects, agents, and operations in this workspace. The user communicates with you, and you manage everything else.

## How You Think
- You are a strategic thinker. You decompose high-level goals into actionable projects, milestones, and agent tasks.
- You ask smart clarifying questions ONLY when the request is genuinely ambiguous. If the user's intent is clear, act immediately.
- You don't ask 10 questions. You ask the minimum needed, infer the rest, propose a plan, and let the user correct.
- If you need zero clarification, skip straight to action.

## How You Work

### When the user gives you a new goal/objective:
1. Assess if you need clarification. If the goal is clear, proceed. If ambiguous, ask focused questions.
2. Create a Project with a clear name, description, and instructions.
3. Define Milestones — measurable checkpoints for the project.
4. Create the right Agents — specialized workers for each task area.
5. Set up a Knowledge Base for the project if needed.
6. Configure Schedules for agents that need to run periodically.
7. Assign agents and KBs to the project.
8. Report your plan to the user.

### When the user asks for a status update:
1. Use ceo_get_project_reports to read all recent run reports.
2. Synthesize the information — don't dump raw reports.
3. Evaluate milestones based on the data.
4. Report: what's working, what's not, what you recommend changing.
5. Save important insights to your memory for future reference.

### When things aren't working:
1. Analyze run reports to identify the problem.
2. Decide on a strategy change (different approach, different tools, different timing).
3. Update agent prompts, schedules, or project instructions as needed.
4. Explain to the user what you changed and why.

## Your Management Style
- Be proactive. Don't wait to be asked — if you see a problem in reports, flag it.
- Be data-driven. Base decisions on run report outcomes, not assumptions.
- Be concise. The user is busy. Lead with the important information.
- Be decisive. Make recommendations, don't just present options.

## What You DON'T Do
- You don't browse the web yourself. You delegate that to agents with browser profiles.
- You don't send emails or LinkedIn messages yourself. You create agents for that.
- You don't do the hands-on work. You manage, strategize, and coordinate.
- You don't create plans without acting on them. If you create a plan, you immediately start executing it (creating agents, schedules, etc.).

## Agent Creation Guidelines
When creating worker agents:
- Give them clear, focused roles (one agent per responsibility area)
- Write detailed system prompts that explain exactly what they should do
- Choose the right model: use cost-efficient models (like claude-sonnet for most tasks, claude-haiku for simple tasks)
- Assign only the integrations and tools they need
- Set up schedules with appropriate timing and humanization

## Memory
Use your memory to remember:
- User's business context, goals, preferences
- What strategies have been tried and their results
- Important decisions and their rationale
- Project states and progress across conversations
`;
```

### 7. Modify Agent Graph for CEO

In `backend/src/graphs/agent.graph.ts`, modify the `createAgentGraph` function:

```typescript
export async function createAgentGraph(
    agentId: string,
    workspaceId: string,
    userId?: string
) {
    const agent = await agentRepository.findById(agentId, workspaceId);
    if (!agent) throw new Error("Agent not found");

    // ... existing model resolution ...

    // NEW: If this is the CEO agent, build CEO-specific tools
    if (agent.isCeo) {
        const ceoTools = buildCEOTools({ agentId, workspaceId });
        langchainTools.push(...ceoTools);
        // CEO tools that mutate state should NOT require approval
        // CEO is trusted to manage the system
    }

    // NEW: If this is the CEO, use the CEO system prompt instead of the regular one
    if (agent.isCeo) {
        // Use CEO_SYSTEM_PROMPT as the base, but still include capability-aware sections
        // for integrations, channels, etc.
        // The CEO prompt replaces the identity + behavior sections but keeps capability sections
    }

    // ... rest of existing logic ...
}
```

**Key decision**: The CEO agent should NOT get browser tools, planning tools (write_todos/update_todo), or other execution-level tools. Only: system tools + CEO tools + memory tools + channel tools (for sending messages to users).

### 8. Auto-Create CEO on Workspace Creation

Modify the workspace creation flow. When a new workspace is created, automatically create the CEO agent:

In `backend/src/services/workspace.service.ts` or wherever workspaces are created:

```typescript
// After creating workspace:
await ceoService.getOrCreateCEO(workspace.id);
```

For existing workspaces, the CEO is created on first access (lazy creation) via the `GET /agents/ceo` endpoint.

---

## Frontend Implementation

### 1. New Pages/Components

#### Projects Page: `frontend/src/app/(dashboard)/projects/page.tsx`
- List all projects with status, milestone progress bar, agent count
- Click to open project detail view
- Create project button (opens dialog)

#### Project Detail View: `frontend/src/app/(dashboard)/projects/[id]/page.tsx`
- Project header: name, description, status, instructions
- Milestones section: list with status badges, progress tracking
- Agents section: assigned agents with their roles
- Knowledge Bases section: linked KBs
- Run Reports section: timeline of recent reports from all project agents
- Edit/delete project controls

#### CEO Chat — No New Page Needed
The CEO uses the existing agent chat interface. But:
- Add a **"Talk to CEO"** button in the sidebar or top bar that navigates to the CEO agent's chat
- The CEO agent should appear distinctly in the agent list (special icon, pinned to top, labeled "CEO")
- On first load, if no CEO exists, auto-create one via `GET /agents/ceo`

### 2. Sidebar Changes
Add "Projects" to the sidebar navigation (between Agents and Schedules, or wherever makes sense).

### 3. Types to Add: `frontend/src/types/index.ts`
```typescript
export interface Project {
    id: string;
    workspaceId: string;
    name: string;
    description: string | null;
    instructions: string | null;
    status: string;
    createdBy: string | null;
    createdAt: string;
    updatedAt: string;
    milestones?: ProjectMilestone[];
    agents?: ProjectAgent[];
    knowledgeBases?: ProjectKB[];
}

export interface ProjectMilestone {
    id: string;
    projectId: string;
    title: string;
    description: string | null;
    status: string;
    targetDate: string | null;
    completedAt: string | null;
    evaluationNotes: string | null;
    sortOrder: number;
    createdAt: string;
    updatedAt: string;
}

export interface ProjectAgent {
    id: string;
    projectId: string;
    agentId: string;
    roleInProject: string | null;
    assignedAt: string;
    agent?: Agent;  // populated from join
}

export interface ProjectKB {
    id: string;
    projectId: string;
    kbId: string;
    assignedAt: string;
    knowledgeBase?: KnowledgeBase;  // populated from join
}

export interface RunReport {
    id: string;
    workspaceId: string;
    agentId: string;
    projectId: string | null;
    sessionId: string | null;
    scheduleId: string | null;
    summary: string;
    actionsTaken: string | null;
    outcomes: string | null;
    issues: string | null;
    metrics: Record<string, unknown>;
    data: Record<string, unknown>;
    runType: string;
    startedAt: string;
    completedAt: string | null;
    createdAt: string;
    agent?: Agent;  // populated from join
}
```

### 4. API Client: `frontend/src/lib/api/projects.ts`
```typescript
// Standard CRUD + assignment endpoints
export const projectsApi = {
    list: (workspaceId: string) => ...,
    get: (workspaceId: string, id: string) => ...,
    create: (workspaceId: string, data: CreateProjectInput) => ...,
    update: (workspaceId: string, id: string, data: UpdateProjectInput) => ...,
    delete: (workspaceId: string, id: string) => ...,
    assignAgent: (workspaceId: string, projectId: string, agentId: string, role?: string) => ...,
    removeAgent: (workspaceId: string, projectId: string, agentId: string) => ...,
    assignKB: (workspaceId: string, projectId: string, kbId: string) => ...,
    removeKB: (workspaceId: string, projectId: string, kbId: string) => ...,
    getMilestones: (workspaceId: string, projectId: string) => ...,
    createMilestone: (workspaceId: string, projectId: string, data: CreateMilestoneInput) => ...,
    updateMilestone: (workspaceId: string, projectId: string, milestoneId: string, data: UpdateMilestoneInput) => ...,
    deleteMilestone: (workspaceId: string, projectId: string, milestoneId: string) => ...,
    getReports: (workspaceId: string, projectId: string, since?: string) => ...,
};
```

### 5. Agent List Modifications
In the agents page (`frontend/src/app/(dashboard)/agents/page.tsx`):
- Pin the CEO agent to the top of the agent list
- Show a distinct visual for the CEO (crown icon, different card style, "CEO" badge)
- Don't allow deleting the CEO agent
- Don't allow changing the CEO's `isCeo` flag from the UI

### 6. Agent Chat Modifications
When chatting with the CEO:
- Show a subtle "CEO Mode" indicator in the chat header
- Tool call visualizations should work as-is (CEO tools will show up just like system tools)
- No other changes needed — the existing chat SSE streaming works perfectly

---

## Migration Plan

### Database Migration
Create a new Drizzle migration that:
1. Creates the 5 new tables (projects, project_milestones, project_agents, project_knowledge_bases, run_reports)
2. Adds `is_ceo` and `agent_type` columns to agents table
3. Adds `project_id` column to schedules table

### Data Migration
For existing workspaces:
- No CEO auto-creation on migration — lazy creation when first accessed
- No need to migrate existing agents (they're all workers by default)

---

## Register Routes

In `backend/src/index.ts`, register the new routes:
```typescript
import { projectRoutes } from "./routes/projects.ts";
import { runReportRoutes } from "./routes/runReports.ts";

// ... in the route registration section:
fastify.register(projectRoutes, { prefix: "/api" });
fastify.register(runReportRoutes, { prefix: "/api" });
```

---

## Implementation Order

Build in this order to avoid dependency issues:

### Phase 1: Database & Schema
1. Create all new Drizzle schema files
2. Modify existing schema files (agents, schedules)
3. Update schema index.ts exports
4. Run migration

### Phase 2: Repositories
5. Create project.repository.ts
6. Create milestone.repository.ts
7. Create runReport.repository.ts

### Phase 3: Services
8. Create project.service.ts
9. Create ceo.service.ts (CEO auto-creation logic)

### Phase 4: CEO Tools
10. Create `backend/src/tools/ceo.tools.ts` with all CEO management tools
11. Create `backend/src/lib/ceo-prompt.ts` with CEO system prompt

### Phase 5: Agent Graph Modifications
12. Modify `agent.graph.ts` — detect CEO agent, inject CEO tools, use CEO prompt
13. Modify `schedule.processor.ts` — add run report generation after every scheduled run

### Phase 6: Routes
14. Create project routes
15. Create run report routes
16. Modify agent routes (add CEO endpoint)
17. Register all new routes in index.ts

### Phase 7: Frontend — Types & API
18. Add new types to frontend types/index.ts
19. Create projects API client
20. Create run reports API client

### Phase 8: Frontend — Pages
21. Add Projects page (list view)
22. Add Project detail page
23. Modify agent list (CEO pinning, badges)
24. Add "Talk to CEO" navigation
25. Add Projects to sidebar

### Phase 9: Integration & Testing
26. Test CEO auto-creation on workspace creation
27. Test CEO creating a project via chat
28. Test CEO creating agents and assigning them
29. Test scheduled run → run report generation
30. Test CEO reading run reports and evaluating milestones

---

## Key Files to Modify (Summary)

### Backend — New Files
- `backend/src/db/schema/projects.ts`
- `backend/src/db/schema/projectMilestones.ts`
- `backend/src/db/schema/projectAgents.ts`
- `backend/src/db/schema/projectKnowledgeBases.ts`
- `backend/src/db/schema/runReports.ts`
- `backend/src/repositories/project.repository.ts`
- `backend/src/repositories/milestone.repository.ts`
- `backend/src/repositories/runReport.repository.ts`
- `backend/src/services/project.service.ts`
- `backend/src/services/ceo.service.ts`
- `backend/src/tools/ceo.tools.ts`
- `backend/src/lib/ceo-prompt.ts`
- `backend/src/routes/projects.ts`
- `backend/src/routes/runReports.ts`

### Backend — Modified Files
- `backend/src/db/schema/agents.ts` — add `isCeo`, `agentType`
- `backend/src/db/schema/schedules.ts` — add `projectId`
- `backend/src/db/schema/index.ts` — add new exports
- `backend/src/graphs/agent.graph.ts` — CEO detection, CEO tools injection, CEO prompt
- `backend/src/processors/schedule.processor.ts` — run report generation
- `backend/src/routes/agents.ts` — CEO endpoint
- `backend/src/index.ts` — register new routes
- `backend/src/services/workspace.service.ts` (or equivalent) — CEO auto-creation

### Frontend — New Files
- `frontend/src/app/(dashboard)/projects/page.tsx`
- `frontend/src/app/(dashboard)/projects/[id]/page.tsx`
- `frontend/src/lib/api/projects.ts`
- `frontend/src/lib/api/run-reports.ts`

### Frontend — Modified Files
- `frontend/src/types/index.ts` — new types
- `frontend/src/app/(dashboard)/agents/page.tsx` — CEO pinning, badges
- `frontend/src/app/(dashboard)/layout.tsx` or sidebar component — Projects nav item
- `frontend/src/components/sidebar.tsx` (or wherever sidebar lives) — Projects link

---

## Notes & Gotchas

1. **CEO should NOT require approval for its management tools**. The CEO is trusted. Set `requireApprovalForAll: false` on the CEO agent, and don't add CEO tools to the `approvalRequired` set.

2. **The CEO model should be the best available**. Currently this could be `claude-sonnet-4-20250514` or ideally `claude-opus-4-20250514` when available. Make this configurable or pick the highest-tier model in the llmModels table.

3. **Run report generation uses an extra LLM call**. This has cost implications. Use a cheaper model (Haiku) for the run report generation step to keep costs down, since it's just summarization.

4. **CEO memory is critical**. The CEO must use the existing `save_memory` tool aggressively to remember project states, decisions, and user preferences across conversations. The CEO prompt should emphasize this.

5. **Project KB data structure is flexible**. When the CEO tells an agent to store data (like leads), the agent stores it as documents in the project's KB. The CEO decides the format. No rigid schema needed — this keeps the platform generic.

6. **CEO and worker agents share the same `agents` table**. The distinction is via `isCeo` and `agentType` columns. This means existing agent CRUD still works for all agents.

7. **Don't over-engineer the frontend**. The Projects page can be simple initially — a list view and a detail view. The CEO manages projects via chat, so the UI is mostly for viewing, not for managing.

8. **Existing features keep working**. Users can still manually create agents, set up schedules, configure integrations — everything works as before. The CEO is an additional layer on top, not a replacement. Users who don't want to use the CEO can ignore it entirely.
