# Projects System — Build Spec

> What we're building, what we're changing, and what we're skipping. Based on the discussion — no fluff.

---

## What a Project IS

A **Project** is an organizational container that groups related work together under a workspace. It holds:

- **Assigned Agents** (many-to-many — agents can belong to multiple projects)
- **Linked Knowledge Bases** (many-to-many — reuse workspace KBs, don't duplicate)
- **Milestones** (trackable goals that make a project more than just a folder)
- **Shared Instructions** (context injected into every agent in the project)
- **Run Reports** (per-project activity feed from agent scheduled runs)
- **Schedule Links** (loose FK — for display/filtering, not ownership)

## What a Project is NOT

- Not a permissions boundary (permissions stay workspace-level via `agentPermissions`)
- Not a resource owner (KBs, skills, tools stay workspace-scoped)
- Not a duplication layer (no project-scoped skills, no project-scoped tools)

---

## Database Changes

### New Tables (5)

#### 1. `projects`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, default random |
| workspace_id | uuid | FK → workspaces.id, CASCADE, NOT NULL |
| name | text | NOT NULL |
| description | text | nullable |
| instructions | text | nullable — shared context for all agents in project |
| status | text | NOT NULL, default 'active' — values: active, paused, completed, archived |
| created_by | uuid | FK → agents.id, SET NULL — which agent (CEO) created it |
| created_at | timestamp | NOT NULL, default now() |
| updated_at | timestamp | NOT NULL, default now() |

> **Note on `status`**: For v1, status is just a label. "Paused" does NOT cascade to agent schedules. That's a future enhancement.

#### 2. `project_milestones`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, default random |
| project_id | uuid | FK → projects.id, CASCADE, NOT NULL |
| workspace_id | uuid | FK → workspaces.id, CASCADE, NOT NULL |
| title | text | NOT NULL |
| description | text | nullable |
| status | text | NOT NULL, default 'not_started' — values: not_started, in_progress, completed, blocked |
| target_date | timestamp | nullable — optional deadline |
| completed_at | timestamp | nullable |
| evaluation_notes | text | nullable — CEO's notes on why status changed |
| sort_order | integer | NOT NULL, default 0 |
| created_at | timestamp | NOT NULL, default now() |
| updated_at | timestamp | NOT NULL, default now() |

#### 3. `project_agents` (junction)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, default random |
| project_id | uuid | FK → projects.id, CASCADE, NOT NULL |
| agent_id | uuid | FK → agents.id, CASCADE, NOT NULL |
| workspace_id | uuid | FK → workspaces.id, CASCADE, NOT NULL |
| role_in_project | text | nullable — e.g., "lead finder", "email outreach" |
| assigned_at | timestamp | NOT NULL, default now() |

> UNIQUE constraint on (project_id, agent_id)

#### 4. `project_knowledge_bases` (junction)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, default random |
| project_id | uuid | FK → projects.id, CASCADE, NOT NULL |
| kb_id | uuid | FK → knowledge_bases.id, CASCADE, NOT NULL |
| workspace_id | uuid | FK → workspaces.id, CASCADE, NOT NULL |
| assigned_at | timestamp | NOT NULL, default now() |

> UNIQUE constraint on (project_id, kb_id)

#### 5. `run_reports`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, default random |
| workspace_id | uuid | FK → workspaces.id, CASCADE, NOT NULL |
| agent_id | uuid | FK → agents.id, CASCADE, NOT NULL |
| project_id | uuid | FK → projects.id, SET NULL — nullable |
| session_id | uuid | FK → sessions.id, SET NULL — nullable |
| schedule_id | uuid | FK → schedules.id, SET NULL — nullable |
| summary | text | NOT NULL — agent's summary of what it did |
| actions_taken | text | nullable |
| outcomes | text | nullable |
| issues | text | nullable |
| metrics | jsonb | NOT NULL, default '{}' — flexible key-value (e.g., leads_found: 15) |
| data | jsonb | NOT NULL, default '{}' — any structured data |
| run_type | text | NOT NULL, default 'scheduled' — values: scheduled, on_demand, ceo_triggered |
| started_at | timestamp | NOT NULL, default now() |
| completed_at | timestamp | nullable |
| created_at | timestamp | NOT NULL, default now() |

### Modified Tables (2)

#### `agents` — add 2 columns
| Column | Type | Notes |
|--------|------|-------|
| is_ceo | boolean | NOT NULL, default false |
| agent_type | text | NOT NULL, default 'worker' — values: 'ceo', 'worker' |

#### `schedules` — add 1 column
| Column | Type | Notes |
|--------|------|-------|
| project_id | uuid | FK → projects.id, SET NULL — optional, for display/filtering only |

---

## Backend — New Files

### Drizzle Schema Files (5)
- `backend/src/db/schema/projects.ts`
- `backend/src/db/schema/projectMilestones.ts`
- `backend/src/db/schema/projectAgents.ts`
- `backend/src/db/schema/projectKnowledgeBases.ts`
- `backend/src/db/schema/runReports.ts`

### Repositories (3)

#### `backend/src/repositories/project.repository.ts`
- `create(data, workspaceId)`
- `findById(id, workspaceId)` — with milestones, agents, KBs populated
- `findByWorkspace(workspaceId)` — list all projects
- `update(id, workspaceId, data)`
- `delete(id, workspaceId)`
- `assignAgent(projectId, agentId, workspaceId, roleInProject?)`
- `removeAgent(projectId, agentId, workspaceId)`
- `getAgents(projectId, workspaceId)` — agents in a project
- `getProjectsForAgent(agentId, workspaceId)` — projects an agent belongs to
- `assignKB(projectId, kbId, workspaceId)`
- `removeKB(projectId, kbId, workspaceId)`
- `getKBs(projectId, workspaceId)`

#### `backend/src/repositories/milestone.repository.ts`
- `create(data, projectId, workspaceId)`
- `findByProject(projectId, workspaceId)`
- `update(id, workspaceId, data)`
- `delete(id, workspaceId)`

#### `backend/src/repositories/runReport.repository.ts`
- `create(data)`
- `findByProject(projectId, workspaceId, opts?)` — with optional date filter
- `findByAgent(agentId, workspaceId, opts?)`
- `findSinceDate(workspaceId, since, projectId?)` — for CEO review
- `findById(id, workspaceId)`

### Services (2)

#### `backend/src/services/project.service.ts`
- Thin layer over project repository
- Validation logic
- Cascading cleanup on delete

#### `backend/src/services/ceo.service.ts`
- `getOrCreateCEO(workspaceId)` — find or create the CEO agent
- `isCEO(agentId, workspaceId)`
- CEO auto-creation config (name, model, permissions, system prompt)

### Tools (1)

#### `backend/src/tools/ceo.tools.ts`
CEO-only tools (given to CEO agent on top of existing system tools):

**Project Management:**
- `ceo_create_project` — create project (name, description, instructions)
- `ceo_update_project` — update project (name, description, instructions, status)
- `ceo_delete_project` — delete project (with name confirmation)
- `ceo_list_projects` — list all projects with status, agent count, milestone progress
- `ceo_get_project_details` — full project details (milestones, agents, KBs, recent reports)

**Milestone Management:**
- `ceo_create_milestone` — add milestone to project
- `ceo_update_milestone` — update milestone status/details
- `ceo_delete_milestone` — remove milestone
- `ceo_evaluate_milestones` — read run reports, auto-evaluate milestone progress

**Agent-Project Assignment:**
- `ceo_assign_agent_to_project` — add agent to project with optional role
- `ceo_remove_agent_from_project` — remove agent from project

**KB-Project Assignment:**
- `ceo_assign_kb_to_project` — link KB to project
- `ceo_remove_kb_from_project` — unlink KB from project

**Run Reports & Monitoring:**
- `ceo_get_project_reports` — get run reports for a project (with date filter)
- `ceo_get_agent_reports` — get run reports for a specific agent

**Agent Instruction:**
- `ceo_message_agent` — send instruction to agent, trigger on-demand run

> **CEO does NOT get**: browser tools, planning tools (write_todos/update_todo), execution-level tools. CEO manages, delegates, and monitors — it doesn't do hands-on work.

### CEO Prompt (1)

#### `backend/src/lib/ceo-prompt.ts`
- Strategic manager persona
- Workflow for new goals: assess → create project → milestones → agents → KBs → schedules → report plan
- Workflow for status checks: read run reports → synthesize → evaluate milestones → report
- Management style: proactive, data-driven, concise, decisive
- Agent creation guidelines (focused roles, appropriate models, minimal permissions)
- Emphasis on memory usage for cross-conversation continuity

### Routes (2 new)

#### `backend/src/routes/projects.ts`
```
GET    /projects                                — list all projects
GET    /projects/:id                            — get project with milestones, agents, KBs
POST   /projects                                — create project
PUT    /projects/:id                            — update project
DELETE /projects/:id                            — delete project
POST   /projects/:id/agents                     — assign agent to project
DELETE /projects/:id/agents/:agentId            — remove agent from project
POST   /projects/:id/milestones                 — create milestone
PUT    /projects/:id/milestones/:milestoneId    — update milestone
DELETE /projects/:id/milestones/:milestoneId    — delete milestone
POST   /projects/:id/kb                         — assign KB to project
DELETE /projects/:id/kb/:kbId                   — remove KB from project
GET    /projects/:id/reports                    — get run reports for project
```

#### `backend/src/routes/runReports.ts`
```
GET /run-reports          — list run reports (filterable by agent, project, date range)
GET /run-reports/:id      — get single run report
```

---

## Backend — Modified Files

| File | Change |
|------|--------|
| `backend/src/db/schema/agents.ts` | Add `isCeo`, `agentType` columns |
| `backend/src/db/schema/schedules.ts` | Add `projectId` column |
| `backend/src/db/schema/index.ts` | Add exports for 5 new schema files |
| `backend/src/graphs/agent.graph.ts` | Detect CEO agent → inject CEO tools, use CEO prompt |
| `backend/src/processors/schedule.processor.ts` | After scheduled run → force agent to write run report → save to DB |
| `backend/src/routes/agents.ts` | Add `GET /agents/ceo` endpoint (returns CEO, auto-creates if needed) |
| `backend/src/index.ts` | Register `projectRoutes` and `runReportRoutes` |
| `backend/src/services/workspace.service.ts` | Call `ceoService.getOrCreateCEO()` after workspace creation |

---

## Frontend — New Files

### Pages (2)

#### `frontend/src/app/(dashboard)/projects/page.tsx`
- List all projects with: status badge, milestone progress bar, agent count
- Click to open project detail
- Create project button/dialog

#### `frontend/src/app/(dashboard)/projects/[id]/page.tsx`
- Project header: name, description, status, instructions
- Milestones section: list with status badges, progress
- Agents section: assigned agents with roles
- Knowledge Bases section: linked KBs
- Run Reports section: timeline of recent reports from project agents
- Edit/delete controls

### API Clients (2)

#### `frontend/src/lib/api/projects.ts`
- Full CRUD for projects
- Agent assignment/removal
- KB assignment/removal
- Milestone CRUD
- Get reports

#### `frontend/src/lib/api/run-reports.ts`
- List run reports (with filters)
- Get single run report

---

## Frontend — Modified Files

| File | Change |
|------|--------|
| `frontend/src/types/index.ts` | Add `Project`, `ProjectMilestone`, `ProjectAgent`, `ProjectKB`, `RunReport` types |
| `frontend/src/components/layout/sidebar.tsx` | Add "Projects" to `navItems` array (between Agents and Integrations) |
| `frontend/src/app/(dashboard)/agents/page.tsx` | Pin CEO to top, crown/badge icon, prevent CEO deletion |

---

## What We're NOT Building (Intentional Skips)

| Skip | Reason |
|------|--------|
| Project-scoped skills | Skills are workspace building blocks, not project-specific |
| Project-scoped tools | Tools are infrastructure, permissioned at agent level |
| Project budget/credit tracking | Future enhancement — credits stay workspace-level for v1 |
| Cascading pause (project pause → schedule pause) | Too complex for v1 — status is just a label |
| Project templates | Future enhancement |
| Heartbeat / auto-review cycle | CEO reviews on-demand only for v1 |
| Manager tier (CEO → Managers → Workers) | Two tiers only for v1 |
| Separate CEO chat UI | CEO uses existing agent chat interface |

---

## Build Order

### Phase 1: Database & Schema
1. Create 5 new Drizzle schema files
2. Modify `agents.ts` (add `isCeo`, `agentType`)
3. Modify `schedules.ts` (add `projectId`)
4. Update `schema/index.ts` exports
5. Generate and run Drizzle migration

### Phase 2: Repositories
6. `project.repository.ts`
7. `milestone.repository.ts`
8. `runReport.repository.ts`

### Phase 3: Services
9. `project.service.ts`
10. `ceo.service.ts`

### Phase 4: CEO Intelligence
11. `ceo-prompt.ts` (CEO system prompt)
12. `ceo.tools.ts` (16 CEO management tools)

### Phase 5: Agent Graph + Schedule Processor
13. Modify `agent.graph.ts` — CEO detection, tool injection, prompt override
14. Modify `schedule.processor.ts` — run report generation after scheduled runs

### Phase 6: Routes
15. `projects.ts` routes (13 endpoints)
16. `runReports.ts` routes (2 endpoints)
17. Modify `agents.ts` routes (add CEO endpoint)
18. Register new routes in `index.ts`

### Phase 7: Frontend Types & API
19. Add types to `frontend/src/types/index.ts`
20. Create `projects.ts` API client
21. Create `run-reports.ts` API client

### Phase 8: Frontend Pages & UI
22. Projects list page
23. Project detail page
24. Sidebar — add Projects nav item
25. Agents page — CEO pinning/badge

---

## File Count Summary

| Category | New | Modified |
|----------|-----|----------|
| Backend Schema | 5 | 3 |
| Backend Repositories | 3 | 0 |
| Backend Services | 2 | 1 |
| Backend Tools/Prompt | 2 | 0 |
| Backend Routes | 2 | 2 |
| Backend Core | 0 | 2 (agent graph, schedule processor) |
| Frontend Pages | 2 | 1 |
| Frontend API | 2 | 0 |
| Frontend Types | 0 | 1 |
| Frontend UI | 0 | 1 (sidebar) |
| **Total** | **18 new** | **11 modified** |
