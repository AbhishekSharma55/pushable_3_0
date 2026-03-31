# Credits & Billing

Pushable AI uses a credit-based billing system. Every action (chat messages, scheduled runs, KB uploads, browser actions) costs credits. Credits are tracked per workspace with support for plan grants, top-ups, and overage.

---

## Overview

```
Workspace Credits
  ├── Plan Credits    (from subscription)
  ├── Top-up Credits  (purchased separately)
  └── Overage Limit   (optional, allows going negative)

Every action:
  1. Calculate cost (base cost × model multiplier)
  2. Check if workspace has enough credits
  3. Execute action
  4. Deduct credits (plan first, then top-up)
  5. Record in credit ledger
```

---

## Credit Balance

Each workspace has a single `credits` record:

```sql
credits
  ├── id                    UUID
  ├── workspaceId           UUID (FK → workspaces, unique)
  ├── planCredits           INTEGER (from subscription, can go negative with overage)
  ├── topupCredits          INTEGER (purchased credits)
  ├── balance               INTEGER (planCredits + topupCredits)
  ├── overageEnabled        BOOLEAN (default: false)
  ├── overageLimit          INTEGER (max negative credits allowed)
  ├── totalCreditsConsumed  INTEGER (lifetime total)
  ├── createdAt             TIMESTAMP
  └── updatedAt             TIMESTAMP
```

### Available Credits

```
available = planCredits + topupCredits
```

### Deduction Order

Credits are deducted in order:
1. **Plan credits** first (from subscription)
2. **Top-up credits** second (purchased)
3. **Overage** if enabled (plan credits go negative, up to `overageLimit`)

---

## Base Credit Costs

| Action | Base Cost | Description |
|--------|-----------|-------------|
| `CHAT_MESSAGE_BASE` | 5 | Per chat message turn |
| `TASK_RUN_BASE` | 100 | Per task/workflow run |
| `WORKFLOW_STEP_BASE` | 100 | Per workflow step |
| `KB_DOCUMENT_UPLOAD` | 20 | Per document uploaded to KB |
| `KB_QUERY` | 2 | Per semantic search query |
| `BROWSER_ACTION` | 10 | Per browser automation action |
| `SCHEDULED_RUN_FEE` | 10 | Additional fee for scheduled runs |
| `AGENT_DELEGATION_MULTIPLIER` | 2x | Multiplier for delegated agent calls |

### Cost Calculation

```typescript
function calculateCreditCost({
  action,
  modelMultiplier = 1.0,
  isScheduled = false,
  isDelegation = false
}): number
```

**Formula:**

```
cost = baseCost × modelMultiplier

if (isScheduled):
  cost += SCHEDULED_RUN_FEE (10)

if (isDelegation):
  cost × AGENT_DELEGATION_MULTIPLIER (2x)

minimum cost = 1 credit
```

### Model Multiplier

Each LLM model has a `multiplier` value stored in the `llm_models` table. More expensive models (like Claude Opus) have higher multipliers than cheaper models (like gemini-3-flash-preview).

For example:
- gemini-3-flash-preview: multiplier 0.5 → chat costs 3 credits
- Claude Sonnet: multiplier 1.0 → chat costs 5 credits
- Claude Opus: multiplier 3.0 → chat costs 15 credits

---

## Credit Check

Before any action, the system checks if the workspace can afford it:

```typescript
async function checkCredits(workspaceId, requiredCredits): Promise<{
  allowed: boolean;
  available: number;
  reason?: "insufficient_credits" | "overage_disabled" | "overage_limit_exceeded";
}>
```

### Check Logic

```
1. Get workspace credit balance
2. If available >= required → allowed
3. If overage disabled → denied (reason: "overage_disabled")
4. If overage enabled:
   - deficit = required - available
   - If deficit <= overageLimit → allowed
   - Else → denied (reason: "overage_limit_exceeded")
```

### When Credits Are Checked

| Action | When |
|--------|------|
| Chat message | Before creating a run |
| Scheduled run | Before executing the agent graph |
| KB upload | Before processing the document |
| Browser action | At session creation |

---

## Credit Deduction

After an action completes successfully:

```typescript
async function deductCredits({
  workspaceId,
  amount,
  type,       // LedgerType
  metadata    // Additional context
}): Promise<{ success: boolean; creditsAfter: number }>
```

### Deduction Steps

1. Load current credit balance
2. Deduct from `planCredits` first (as much as possible)
3. Deduct remaining from `topupCredits`
4. Any remaining goes as negative `planCredits` (overage)
5. Update the `credits` record
6. Insert a `creditLedger` entry

### Fire-and-Forget

Some credit deductions are fire-and-forget (non-blocking) to avoid slowing down the user experience:
- KB upload credits are deducted after the upload completes
- Chat message credits may be deducted in the background

---

## Adding Credits

```typescript
async function addCredits({
  workspaceId,
  amount,
  type,       // "subscription_grant" | "topup" | "refund" | "manual_adjustment"
  metadata
}): Promise<{ creditsAfter: number }>
```

### Credit Types

| Type | Goes To | Triggered By |
|------|---------|-------------|
| `subscription_grant` | Plan credits | Subscription renewal |
| `topup` | Top-up credits | Credit purchase or dev top-up |
| `refund` | Top-up credits | Refund processing |
| `manual_adjustment` | Top-up credits | Admin manual adjustment |

---

## Credit Ledger

Every credit change is recorded in the ledger for full auditability:

```sql
credit_ledger
  ├── id           UUID
  ├── workspaceId  UUID (FK → workspaces)
  ├── amount       INTEGER (positive = addition, negative = deduction)
  ├── type         ENUM (see below)
  ├── creditsAfter INTEGER (balance after this transaction)
  ├── metadata     JSONB (context-specific data)
  ├── createdAt    TIMESTAMP
  └── updatedAt    TIMESTAMP
```

### Ledger Types

| Type | Direction | Description |
|------|-----------|-------------|
| `subscription_grant` | + | Monthly subscription credits |
| `topup` | + | Purchased credits |
| `chat_message` | - | Chat conversation turn |
| `task_run` | - | Task execution |
| `workflow_step` | - | Workflow step execution |
| `kb_upload` | - | Knowledge base document upload |
| `kb_query` | - | Semantic search query |
| `browser_action` | - | Browser automation action |
| `scheduled_run_fee` | - | Scheduled agent run |
| `agent_delegation` | - | Agent-to-agent delegation |
| `overage` | - | Usage beyond plan limit |
| `refund` | + | Credit refund |
| `manual_adjustment` | +/- | Admin adjustment |

### Metadata Examples

Chat message:
```json
{ "sessionId": "...", "agentId": "...", "model": "claude-sonnet-4" }
```

Scheduled run:
```json
{ "scheduleId": "...", "agentId": "...", "durationMs": 4523 }
```

KB upload:
```json
{ "kbId": "...", "documentId": "...", "filename": "report.pdf" }
```

---

## Plan Tiers

The platform supports four plan tiers:

| Tier | Order | Description |
|------|-------|-------------|
| `free` | 0 | Basic access |
| `starter` | 1 | More credits, more models |
| `pro` | 2 | Full model access |
| `scale` | 3 | Enterprise-level access |

### Plan Gating

Each LLM model has a `minimumPlan` field. Models are only available to workspaces on a sufficient plan:

```typescript
function isPlanSufficient(workspacePlan, requiredPlan): boolean {
  return PLAN_ORDER[workspacePlan] >= PLAN_ORDER[requiredPlan];
}
```

Currently all workspaces default to the `"scale"` plan (hardcoded in `getWorkspacePlan()`), as the subscription system is not yet built.

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/credits/balance` | Get current credit balance |
| `GET` | `/api/credits/ledger` | Get credit transaction history (paginated) |
| `POST` | `/api/credits/dev-topup` | Add credits (dev/testing only) |

### Get Balance

```
GET /api/credits/balance
```

Response:
```json
{
  "data": {
    "planCredits": 4500,
    "topupCredits": 1000,
    "availableCredits": 5500,
    "overageEnabled": false,
    "overageLimit": 0,
    "totalConsumed": 23450
  }
}
```

### Get Ledger

```
GET /api/credits/ledger?limit=50&type=chat_message
```

Response:
```json
{
  "data": [
    {
      "id": "uuid",
      "amount": -5,
      "type": "chat_message",
      "creditsAfter": 5495,
      "metadata": { "sessionId": "...", "agentId": "..." },
      "createdAt": "2026-03-26T10:30:00Z"
    }
  ],
  "nextCursor": "uuid-for-pagination"
}
```

### Dev Top-up

```json
POST /api/credits/dev-topup
{
  "amount": 10000
}
```

Max: 10,000,000 credits per top-up. This endpoint is for development/testing.

---

## Frontend Credits UI

The credits page (`/credits`) displays:
- **Current balance** -- Plan credits, top-up credits, total available
- **Usage charts** -- Credit consumption over time (via Recharts)
- **Transaction history** -- Ledger entries with type, amount, and metadata
- **Filtering** -- Filter by transaction type

---

## Credit Flow Diagram

```
User sends chat message
  │
  ▼
checkCredits(workspaceId, 5 × modelMultiplier)
  │
  ├─ Not enough? → Return 402 INSUFFICIENT_CREDITS
  │
  ▼ (allowed)
Execute agent graph
  │
  ▼
deductCredits({
  workspaceId,
  amount: 5 × modelMultiplier,
  type: "chat_message",
  metadata: { sessionId, agentId, model }
})
  │
  ├─ planCredits -= min(planCredits, amount)
  ├─ topupCredits -= min(topupCredits, remaining)
  ├─ balance updated
  └─ Ledger entry created
```

---

## Next Steps

- [File Management](./12-file-management.md) -- Upload, storage, and file preview
- [Admin Panel](./13-admin-panel.md) -- System administration
