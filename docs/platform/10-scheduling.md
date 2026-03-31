# Scheduling

The scheduling system allows agents to run tasks automatically on a recurring basis. Schedules support cron expressions, natural language descriptions, presets, business hours constraints, and humanization delays.

---

## Architecture

```
Schedule Creation (API)
  │
  ▼
BullMQ Repeating Job (Redis)
  │
  ▼  (cron fires)
Schedule Worker
  │
  ▼
Humanization (delay + business hours check)
  │
  ▼
Credit Check
  │
  ▼
Agent Graph Execution (same as chat, without streaming)
  │
  ▼
Result Logging + Credit Deduction
```

---

## Schedule Types

### 1. Preset Schedules

Pre-configured schedule templates available out of the box:

| Key | Label | Cron | Humanize Delay |
|-----|-------|------|----------------|
| `weekday_morning` | Every weekday morning | `0 9 * * 1-5` | 15 min |
| `weekday_evening` | Every weekday evening | `0 18 * * 1-5` | 10 min |
| `daily_noon` | Every day at noon | `0 12 * * *` | 5 min |
| `monday_morning` | Every Monday morning | `0 9 * * 1` | 15 min |
| `friday_afternoon` | Every Friday afternoon | `0 16 * * 5` | 20 min |
| `twice_daily` | Twice a day | `0 9,15 * * 1-5` | 10 min |
| `hourly_business` | Every hour (business hours) | `0 9-18 * * 1-5` | 5 min |
| `first_of_month` | First of every month | `0 9 1 * *` | 15 min |
| `every_30min_business` | Every 30 minutes (business hours) | `*/30 9-18 * * 1-5` | 0 min |
| `custom` | Custom schedule | _(user-defined)_ | 0 min |

### 2. Natural Language Schedules

Users can describe schedules in plain English:

```
"every weekday morning"          → 0 9 * * 1-5
"twice a week on tues and thurs" → 0 14 * * 2,4
"every hour"                     → 0 * * * *
```

The backend uses an LLM to convert natural language to cron:
- **Via OpenRouter:** Uses `google/gemini-2.0-flash-001` (default)
- **Via Claude gateway:** Uses `claude-haiku-4-5-20251001`

The LLM returns:
```json
{
  "cron": "0 9 * * 1-5",
  "humanReadable": "Every weekday at 9:00 AM",
  "confidence": "high"
}
```

If confidence is `"low"`, the conversion is rejected and the user is asked to be more specific.

### 3. Custom Cron Expressions

Users can enter standard 5-field cron expressions directly:
```
minute hour day-of-month month day-of-week
```

The expression is validated using `cron-parser` before saving.

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/schedules/presets` | Get available schedule presets |
| `POST` | `/api/schedules/preview` | Preview natural language → cron conversion |
| `GET` | `/api/schedules` | List all schedules in workspace |
| `POST` | `/api/schedules` | Create a new schedule |
| `GET` | `/api/schedules/:id` | Get schedule details |
| `PUT` | `/api/schedules/:id` | Update a schedule |
| `DELETE` | `/api/schedules/:id` | Delete a schedule |
| `GET` | `/api/schedules/:id/runs` | Get paginated run history |
| `GET` | `/api/schedules/:id/stats` | Get aggregate statistics |

### Create Schedule

```json
POST /api/schedules
{
  "name": "Morning Lead Check",
  "agentId": "uuid-of-agent",
  "prompt": "Check for new leads in the CRM and send me a summary",
  "enabled": true,
  "scheduleType": "preset",
  "presetKey": "weekday_morning",
  "timezone": "Asia/Kolkata",
  "humanizeDelay": 15,
  "businessHoursOnly": true,
  "workStartHour": 9,
  "workEndHour": 18,
  "workDays": [1, 2, 3, 4, 5]
}
```

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Schedule display name |
| `agentId` | UUID | Yes | Agent to execute |
| `prompt` | string | Yes | Message sent to the agent |
| `enabled` | boolean | No | Start enabled (default: true) |
| `scheduleType` | enum | Yes | `"natural"`, `"preset"`, or `"custom"` |
| `naturalLanguage` | string | If natural | Plain English description |
| `presetKey` | string | If preset | Key from presets list |
| `cronExpression` | string | If custom | 5-field cron expression |
| `timezone` | string | No | IANA timezone (default: `"UTC"`) |
| `humanizeDelay` | number | No | Max random delay in minutes (0-30) |
| `businessHoursOnly` | boolean | No | Skip runs outside work hours |
| `workStartHour` | number | No | Business hours start (default: 9) |
| `workEndHour` | number | No | Business hours end (default: 18) |
| `workDays` | number[] | No | Work days, 0=Sun..6=Sat (default: [1,2,3,4,5]) |

### Preview Natural Language

```json
POST /api/schedules/preview
{
  "naturalLanguage": "every Tuesday and Thursday at 2pm",
  "timezone": "America/New_York"
}
```

Returns:
```json
{
  "data": {
    "cron": "0 14 * * 2,4",
    "humanReadable": "Every Tuesday and Thursday at 2:00 PM",
    "nextRuns": [
      "Tue, Mar 28 at 2:00 PM EDT",
      "Thu, Mar 30 at 2:00 PM EDT",
      "Tue, Apr 4 at 2:00 PM EDT",
      "Thu, Apr 6 at 2:00 PM EDT",
      "Tue, Apr 11 at 2:00 PM EDT"
    ]
  }
}
```

---

## Humanization

Humanization makes scheduled runs feel less robotic by adding randomness and business-hours awareness.

### Humanize Delay

When `humanizeDelay > 0`, the worker adds a random delay before executing:

```
actual_delay = random(0, humanizeDelay * 60 * 1000) milliseconds
```

For example, a 15-minute humanize delay adds a random 0-15 minute delay to each run. This prevents all schedules from firing at exactly the same second.

### Business Hours Check

When `businessHoursOnly: true`, the worker checks:

1. **Day of week** -- Is today in `workDays`? (default: Mon-Fri)
2. **Hour** -- Is the current hour within `workStartHour` to `workEndHour`? (default: 9-18)

If outside business hours, the run is **skipped** (status: `"skipped"`), not deferred.

All time checks use the schedule's configured `timezone`.

---

## Job Queue (BullMQ + Redis)

### Queue Configuration

- **Queue name:** `"schedules"`
- **Redis connection:** `process.env.REDIS_URL` (default: `redis://localhost:6379`)
- **Worker concurrency:** 1 (single worker to prevent race conditions)

### Job Registration

When a schedule is created or enabled:

```typescript
scheduleQueue.add(`schedule-${schedule.id}`, payload, {
  repeat: {
    pattern: schedule.cron,
    tz: schedule.timezone || "UTC",
  },
  jobId: `schedule-${schedule.id}`,
});
```

### Job Lifecycle

| Action | Effect |
|--------|--------|
| Create schedule (enabled) | Register repeating job in BullMQ |
| Create schedule (disabled) | No job registered |
| Enable schedule | Register job |
| Disable schedule | Remove repeating job |
| Update cron/timezone | Remove old job, register new one |
| Delete schedule | Remove job, delete database record |

### Scheduler Initialization

On backend startup, `initScheduler()`:
1. Loads all enabled schedules from the database
2. Registers each as a repeating BullMQ job
3. Logs the count of loaded schedules

---

## Schedule Execution

When a cron fires, the `processSchedule` function runs:

### Execution Flow

1. **Create run record** in `schedule_runs` table
2. **Humanization check:**
   - Apply random delay if `humanizeDelay > 0`
   - Check business hours if `businessHoursOnly: true`
   - If outside hours → mark run as `"skipped"` and return
3. **Credit check:**
   - Calculate estimated cost
   - Verify workspace has sufficient credits
   - If insufficient → mark run as `"failed"` with reason
4. **Agent graph execution:**
   - Create agent graph for the scheduled agent
   - Invoke with the schedule's prompt as a `HumanMessage`
   - Use `schedule-{scheduleId}` as the thread ID (separate from chat sessions)
5. **Record results:**
   - Deduct credits (type: `"scheduled_run_fee"`)
   - Save run result text, credits used, and duration
   - Update schedule's `lastRunAt` timestamp
6. **Error handling:**
   - On failure → save error message and duration to run record

---

## Run History

### Database Schema

```sql
schedule_runs
  ├── id           UUID
  ├── scheduleId   UUID (FK → schedules, cascade delete)
  ├── workspaceId  UUID (FK → workspaces, cascade delete)
  ├── status       ENUM: running, completed, failed, skipped
  ├── resultText   TEXT (agent's response, nullable)
  ├── error        TEXT (error message, nullable)
  ├── creditsUsed  INTEGER (default: 0)
  ├── durationMs   INTEGER (execution time, nullable)
  ├── createdAt    TIMESTAMP
  └── updatedAt    TIMESTAMP
```

### Run Statuses

| Status | Meaning |
|--------|---------|
| `running` | Currently executing |
| `completed` | Finished successfully |
| `failed` | Error occurred (credit check failed, agent error, etc.) |
| `skipped` | Outside business hours |

### Paginated History

```
GET /api/schedules/:id/runs?limit=50&offset=0
```

Returns runs ordered by creation date (newest first), max 100 per page.

### Aggregate Statistics

```
GET /api/schedules/:id/stats
```

Returns aggregate data like total runs, success rate, average duration, and total credits consumed.

---

## Schedule Database Schema

```sql
schedules
  ├── id                 UUID
  ├── workspaceId        UUID (FK → workspaces, cascade delete)
  ├── agentId            UUID (FK → agents, cascade delete)
  ├── name               TEXT
  ├── prompt             TEXT (message sent to agent)
  ├── cron               TEXT (5-field cron expression)
  ├── enabled            BOOLEAN (default: true)
  ├── scheduleType       ENUM: natural, preset, custom
  ├── presetKey          TEXT (nullable)
  ├── naturalLanguage    TEXT (nullable, original NL input)
  ├── humanizeDelay      INTEGER (minutes, default: 0)
  ├── timezone           TEXT (default: "UTC")
  ├── businessHoursOnly  BOOLEAN (default: false)
  ├── workStartHour      INTEGER (default: 9)
  ├── workEndHour        INTEGER (default: 18)
  ├── workDays           JSONB (array of day numbers, default: [1,2,3,4,5])
  ├── nextRunDescription TEXT (human-readable next run time)
  ├── lastRunAt          TIMESTAMP (nullable)
  ├── createdAt          TIMESTAMP
  └── updatedAt          TIMESTAMP
```

---

## Frontend Schedule UI

The schedules page (`/schedules`) provides:

- **Schedule list** -- All schedules with status, next run time, and last run
- **Create schedule** -- Side panel with preset selector, natural language input, or custom cron
- **Schedule detail** (`/schedules/:id`) -- Configuration, run history table, and statistics
- **Run history** -- Status indicators, execution time, credit cost, timestamps
- **Enable/disable toggle** -- Pause and resume schedules
- **Manual trigger** -- Trigger a run immediately

---

## Next Steps

- [Credits & Billing](./11-credits-billing.md) -- Credit system and usage tracking
- [File Management](./12-file-management.md) -- Upload, storage, and file preview
