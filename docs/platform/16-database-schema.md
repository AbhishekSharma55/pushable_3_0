# Database Schema

The platform uses PostgreSQL 16 with the pgvector extension for vector similarity search. The ORM is Drizzle ORM 0.45.1. This document lists all 33+ tables with their columns, types, and relationships.

---

## Schema Overview

```
Users & Workspaces
  ├── users
  ├── workspaces
  └── workspace_members

Agents
  ├── agents
  ├── agent_permissions
  ├── agent_integrations
  └── agent_memories

Chat & Sessions
  ├── sessions
  ├── messages
  └── runs

Knowledge Base
  ├── knowledge_bases
  ├── kb_documents
  └── kb_chunks (with pgvector embeddings)

Tools & Skills
  ├── tools
  └── skills

Scheduling
  ├── schedules
  └── schedule_runs

Projects & CEO
  ├── projects
  ├── project_milestones
  ├── project_agents
  ├── project_knowledge_bases
  └── run_reports

Browser Automation
  ├── browser_profiles
  ├── browser_sessions
  └── browser_proxies

Channels & Integrations
  ├── integrations
  ├── input_channels
  └── channel_connections

Vault
  ├── vault_connections
  └── vault_audit_logs

Credits & Billing
  ├── credits
  ├── credit_logs
  └── credit_ledger

Files
  └── bucket_files

LLM
  └── llm_models

Content
  ├── blogs
  └── contact_submissions
```

---

## Enums

```sql
-- User/Permission
CREATE TYPE member_role AS ENUM ('owner', 'admin', 'member');
CREATE TYPE resource_type AS ENUM ('tool', 'kb', 'skill', 'agent');

-- Messages
CREATE TYPE message_role AS ENUM ('user', 'assistant', 'tool');

-- Runs
CREATE TYPE run_status AS ENUM ('queued', 'in_progress', 'completed', 'failed', 'interrupted', 'cancelled');
CREATE TYPE schedule_run_status AS ENUM ('running', 'completed', 'failed', 'skipped');

-- Scheduling
CREATE TYPE schedule_type AS ENUM ('natural', 'preset', 'custom');

-- Tools
CREATE TYPE tool_type AS ENUM ('mcp', 'function');

-- Browser
CREATE TYPE browser_profile_status AS ENUM ('active', 'inactive');
CREATE TYPE browser_session_status AS ENUM ('starting', 'active', 'closed', 'error');
CREATE TYPE proxy_protocol AS ENUM ('http', 'https', 'socks5');
CREATE TYPE proxy_test_status AS ENUM ('success', 'failed', 'untested');

-- Channels
CREATE TYPE channel_type AS ENUM ('telegram', 'slack');
CREATE TYPE connection_status AS ENUM ('active', 'inactive', 'error');

-- Integrations
CREATE TYPE integration_status AS ENUM ('active', 'inactive', 'pending', 'failed');

-- Vault
CREATE TYPE vault_provider AS ENUM ('bitwarden');
CREATE TYPE vault_connection_status AS ENUM ('active', 'inactive', 'failed');
CREATE TYPE vault_audit_action AS ENUM ('connect', 'disconnect', 'credential_fetch', 'token_refresh', 'test', 'error');

-- Files
CREATE TYPE file_source AS ENUM ('chat_upload', 'agent_generated', 'api_upload');

-- LLM
CREATE TYPE llm_provider AS ENUM ('openai', 'anthropic', 'google', 'deepseek', 'meta');
CREATE TYPE plan_tier AS ENUM ('free', 'starter', 'pro', 'scale');

-- Credits
CREATE TYPE ledger_type AS ENUM (
  'subscription_grant', 'topup', 'chat_message', 'task_run', 'workflow_step',
  'kb_upload', 'kb_query', 'browser_action', 'scheduled_run_fee',
  'agent_delegation', 'overage', 'refund', 'manual_adjustment'
);
```

---

## Users & Workspaces

### users

| Column | Type | Constraints |
|--------|------|------------|
| `id` | UUID | PK, default random |
| `name` | TEXT | NOT NULL |
| `email` | TEXT | NOT NULL, UNIQUE |
| `password_hash` | TEXT | NOT NULL |
| `created_at` | TIMESTAMP | NOT NULL, default NOW |
| `updated_at` | TIMESTAMP | NOT NULL, default NOW |

### workspaces

| Column | Type | Constraints |
|--------|------|------------|
| `id` | UUID | PK, default random |
| `name` | TEXT | NOT NULL |
| `slug` | TEXT | NOT NULL, UNIQUE |
| `owner_id` | UUID | NOT NULL, FK → users(id) |
| `extension_api_key` | TEXT | Nullable |
| `created_at` | TIMESTAMP | NOT NULL, default NOW |
| `updated_at` | TIMESTAMP | NOT NULL, default NOW |

### workspace_members

| Column | Type | Constraints |
|--------|------|------------|
| `id` | UUID | PK, default random |
| `workspace_id` | UUID | NOT NULL, FK → workspaces(id) CASCADE |
| `user_id` | UUID | NOT NULL, FK → users(id) CASCADE |
| `role` | member_role | NOT NULL, default 'member' |
| `created_at` | TIMESTAMP | NOT NULL, default NOW |

---

## Agents

### agents

| Column | Type | Constraints |
|--------|------|------------|
| `id` | UUID | PK, default random |
| `workspace_id` | UUID | NOT NULL, FK → workspaces(id) CASCADE |
| `name` | TEXT | NOT NULL |
| `system_prompt` | TEXT | Nullable |
| `model` | TEXT | NOT NULL, default 'gpt-4o-mini' |
| `temperature` | REAL | NOT NULL, default 0.7 |
| `system_level_access` | BOOLEAN | NOT NULL, default false |
| `can_manage_kb` | BOOLEAN | NOT NULL, default false |
| `can_manage_skills` | BOOLEAN | NOT NULL, default false |
| `can_manage_tools` | BOOLEAN | NOT NULL, default false |
| `can_manage_schedules` | BOOLEAN | NOT NULL, default false |
| `can_manage_channels` | BOOLEAN | NOT NULL, default false |
| `can_manage_agents` | BOOLEAN | NOT NULL, default false |
| `can_manage_bucket` | BOOLEAN | NOT NULL, default false |
| `can_execute_python` | BOOLEAN | NOT NULL, default true |
| `require_approval_for_all` | BOOLEAN | NOT NULL, default false |
| `browser_type` | TEXT | NOT NULL, default 'cloud' |
| `browser_enabled` | BOOLEAN | NOT NULL, default true |
| `browser_proxy_id` | UUID | FK → browser_proxies(id) SET NULL |
| `created_at` | TIMESTAMP | NOT NULL, default NOW |
| `updated_at` | TIMESTAMP | NOT NULL, default NOW |

### agent_permissions

| Column | Type | Constraints |
|--------|------|------------|
| `id` | UUID | PK, default random |
| `workspace_id` | UUID | NOT NULL, FK → workspaces(id) CASCADE |
| `agent_id` | UUID | NOT NULL, FK → agents(id) CASCADE |
| `resource_type` | resource_type | NOT NULL |
| `resource_id` | UUID | NOT NULL |
| `allowed` | BOOLEAN | NOT NULL, default true |
| `created_at` | TIMESTAMP | NOT NULL, default NOW |

### agent_integrations

| Column | Type | Constraints |
|--------|------|------------|
| `id` | UUID | PK, default random |
| `workspace_id` | UUID | NOT NULL, FK → workspaces(id) CASCADE |
| `agent_id` | UUID | NOT NULL, FK → agents(id) CASCADE |
| `integration_id` | UUID | NOT NULL, FK → integrations(id) CASCADE |
| `created_at` | TIMESTAMP | NOT NULL, default NOW |

### agent_memories

| Column | Type | Constraints |
|--------|------|------------|
| `id` | UUID | PK, default random |
| `workspace_id` | UUID | NOT NULL, FK → workspaces(id) CASCADE |
| `agent_id` | UUID | NOT NULL, FK → agents(id) CASCADE |
| `user_id` | UUID | NOT NULL |
| `content` | TEXT | NOT NULL |
| `category` | TEXT | default 'general' |
| `created_at` | TIMESTAMP | NOT NULL, default NOW |

---

## Chat & Sessions

### sessions

| Column | Type | Constraints |
|--------|------|------------|
| `id` | UUID | PK, default random |
| `workspace_id` | UUID | NOT NULL, FK → workspaces(id) CASCADE |
| `agent_id` | UUID | NOT NULL, FK → agents(id) CASCADE |
| `title` | TEXT | NOT NULL |
| `created_at` | TIMESTAMP | NOT NULL, default NOW |
| `updated_at` | TIMESTAMP | NOT NULL, default NOW |

### messages

| Column | Type | Constraints |
|--------|------|------------|
| `id` | UUID | PK, default random |
| `workspace_id` | UUID | NOT NULL, FK → workspaces(id) CASCADE |
| `session_id` | UUID | NOT NULL, FK → sessions(id) CASCADE |
| `role` | message_role | NOT NULL |
| `content` | TEXT | NOT NULL |
| `token_count` | INTEGER | NOT NULL, default 0 |
| `metadata` | JSONB | Nullable |
| `created_at` | TIMESTAMP | NOT NULL, default NOW |

### runs

| Column | Type | Constraints |
|--------|------|------------|
| `id` | UUID | PK, default random |
| `session_id` | UUID | NOT NULL, FK → sessions(id) CASCADE |
| `workspace_id` | UUID | NOT NULL, FK → workspaces(id) CASCADE |
| `status` | run_status | NOT NULL, default 'queued' |
| `error` | TEXT | Nullable |
| `created_at` | TIMESTAMP | NOT NULL, default NOW |
| `updated_at` | TIMESTAMP | NOT NULL, default NOW |

---

## Knowledge Base

### knowledge_bases

| Column | Type | Constraints |
|--------|------|------------|
| `id` | UUID | PK, default random |
| `workspace_id` | UUID | NOT NULL, FK → workspaces(id) CASCADE |
| `name` | TEXT | NOT NULL |
| `description` | TEXT | Nullable |
| `created_at` | TIMESTAMP | NOT NULL, default NOW |
| `updated_at` | TIMESTAMP | NOT NULL, default NOW |

### kb_documents

| Column | Type | Constraints |
|--------|------|------------|
| `id` | UUID | PK, default random |
| `workspace_id` | UUID | NOT NULL, FK → workspaces(id) CASCADE |
| `kb_id` | UUID | NOT NULL, FK → knowledge_bases(id) CASCADE |
| `filename` | TEXT | NOT NULL |
| `chunk_count` | INTEGER | NOT NULL, default 0 |
| `created_at` | TIMESTAMP | NOT NULL, default NOW |
| `updated_at` | TIMESTAMP | NOT NULL, default NOW |

### kb_chunks

| Column | Type | Constraints |
|--------|------|------------|
| `id` | UUID | PK, default random |
| `workspace_id` | UUID | NOT NULL, FK → workspaces(id) CASCADE |
| `kb_id` | UUID | NOT NULL, FK → knowledge_bases(id) CASCADE |
| `document_id` | UUID | NOT NULL, FK → kb_documents(id) CASCADE |
| `content` | TEXT | NOT NULL |
| `embedding` | REAL[] | 1536-dimension vector |
| `metadata` | JSONB | Nullable |
| `created_at` | TIMESTAMP | NOT NULL, default NOW |

---

## Tools & Skills

### tools

| Column | Type | Constraints |
|--------|------|------------|
| `id` | UUID | PK, default random |
| `workspace_id` | UUID | FK → workspaces(id) CASCADE |
| `name` | TEXT | NOT NULL |
| `description` | TEXT | Nullable |
| `type` | tool_type | NOT NULL |
| `config` | JSONB | NOT NULL, default {} |
| `is_global` | BOOLEAN | NOT NULL, default false |
| `requires_approval` | BOOLEAN | NOT NULL, default false |
| `created_at` | TIMESTAMP | NOT NULL, default NOW |
| `updated_at` | TIMESTAMP | NOT NULL, default NOW |

### skills

| Column | Type | Constraints |
|--------|------|------------|
| `id` | UUID | PK, default random |
| `workspace_id` | UUID | NOT NULL, FK → workspaces(id) CASCADE |
| `name` | TEXT | NOT NULL |
| `description` | TEXT | Nullable |
| `origin` | TEXT | Nullable |
| `instructions` | TEXT | NOT NULL |
| `created_at` | TIMESTAMP | NOT NULL, default NOW |
| `updated_at` | TIMESTAMP | NOT NULL, default NOW |

---

## Scheduling

### schedules

| Column | Type | Constraints |
|--------|------|------------|
| `id` | UUID | PK, default random |
| `workspace_id` | UUID | NOT NULL, FK → workspaces(id) CASCADE |
| `agent_id` | UUID | NOT NULL, FK → agents(id) CASCADE |
| `name` | TEXT | NOT NULL |
| `prompt` | TEXT | NOT NULL |
| `cron` | TEXT | NOT NULL |
| `enabled` | BOOLEAN | NOT NULL, default true |
| `schedule_type` | schedule_type | NOT NULL |
| `preset_key` | TEXT | Nullable |
| `natural_language` | TEXT | Nullable |
| `humanize_delay` | INTEGER | NOT NULL, default 0 |
| `timezone` | TEXT | NOT NULL, default 'UTC' |
| `business_hours_only` | BOOLEAN | NOT NULL, default false |
| `work_start_hour` | INTEGER | NOT NULL, default 9 |
| `work_end_hour` | INTEGER | NOT NULL, default 18 |
| `work_days` | JSONB | NOT NULL, default [1,2,3,4,5] |
| `next_run_description` | TEXT | Nullable |
| `last_run_at` | TIMESTAMP | Nullable |
| `created_at` | TIMESTAMP | NOT NULL, default NOW |
| `updated_at` | TIMESTAMP | NOT NULL, default NOW |

### schedule_runs

| Column | Type | Constraints |
|--------|------|------------|
| `id` | UUID | PK, default random |
| `schedule_id` | UUID | NOT NULL, FK → schedules(id) CASCADE |
| `workspace_id` | UUID | NOT NULL, FK → workspaces(id) CASCADE |
| `status` | schedule_run_status | NOT NULL, default 'running' |
| `result_text` | TEXT | Nullable |
| `error` | TEXT | Nullable |
| `credits_used` | INTEGER | NOT NULL, default 0 |
| `duration_ms` | INTEGER | Nullable |
| `created_at` | TIMESTAMP | NOT NULL, default NOW |
| `updated_at` | TIMESTAMP | NOT NULL, default NOW |

---

## Projects & CEO

### projects

| Column | Type | Constraints |
|--------|------|------------|
| `id` | UUID | PK, default random |
| `workspace_id` | UUID | NOT NULL, FK → workspaces(id) CASCADE |
| `name` | TEXT | NOT NULL |
| `description` | TEXT | Nullable |
| `instructions` | TEXT | Nullable |
| `status` | TEXT | NOT NULL, default 'active' |
| `created_by` | UUID | Nullable |
| `created_at` | TIMESTAMP | NOT NULL, default NOW |
| `updated_at` | TIMESTAMP | NOT NULL, default NOW |

### project_milestones

| Column | Type | Constraints |
|--------|------|------------|
| `id` | UUID | PK, default random |
| `project_id` | UUID | NOT NULL, FK → projects(id) CASCADE |
| `workspace_id` | UUID | NOT NULL, FK → workspaces(id) CASCADE |
| `title` | TEXT | NOT NULL |
| `description` | TEXT | Nullable |
| `status` | TEXT | NOT NULL, default 'pending' |
| `target_date` | TIMESTAMP | Nullable |
| `completed_at` | TIMESTAMP | Nullable |
| `evaluation_notes` | TEXT | Nullable |
| `sort_order` | INTEGER | NOT NULL, default 0 |
| `created_at` | TIMESTAMP | NOT NULL, default NOW |
| `updated_at` | TIMESTAMP | NOT NULL, default NOW |

### project_agents

| Column | Type | Constraints |
|--------|------|------------|
| `id` | UUID | PK, default random |
| `project_id` | UUID | NOT NULL, FK → projects(id) CASCADE |
| `agent_id` | UUID | NOT NULL, FK → agents(id) CASCADE |
| `workspace_id` | UUID | NOT NULL, FK → workspaces(id) CASCADE |
| `role_in_project` | TEXT | Nullable |
| `assigned_at` | TIMESTAMP | NOT NULL, default NOW |

**Unique constraint:** `(project_id, agent_id)`

### project_knowledge_bases

| Column | Type | Constraints |
|--------|------|------------|
| `id` | UUID | PK, default random |
| `project_id` | UUID | NOT NULL, FK → projects(id) CASCADE |
| `kb_id` | UUID | NOT NULL, FK → knowledge_bases(id) CASCADE |
| `workspace_id` | UUID | NOT NULL, FK → workspaces(id) CASCADE |
| `assigned_at` | TIMESTAMP | NOT NULL, default NOW |

**Unique constraint:** `(project_id, kb_id)`

### run_reports

| Column | Type | Constraints |
|--------|------|------------|
| `id` | UUID | PK, default random |
| `workspace_id` | UUID | NOT NULL, FK → workspaces(id) CASCADE |
| `agent_id` | UUID | NOT NULL, FK → agents(id) CASCADE |
| `project_id` | UUID | Nullable, FK → projects(id) SET NULL |
| `session_id` | UUID | Nullable |
| `schedule_id` | UUID | Nullable |
| `summary` | TEXT | Nullable |
| `actions_taken` | TEXT | Nullable |
| `outcomes` | TEXT | Nullable |
| `issues` | TEXT | Nullable |
| `metrics` | JSONB | Nullable |
| `data` | JSONB | Nullable |
| `run_type` | TEXT | Nullable |
| `started_at` | TIMESTAMP | Nullable |
| `completed_at` | TIMESTAMP | Nullable |
| `created_at` | TIMESTAMP | NOT NULL, default NOW |

### New columns on existing tables

**agents:** Added `is_ceo` (BOOLEAN, default false) and `agent_type` (TEXT, default 'agent').

**schedules:** Added `project_id` (UUID, Nullable, FK → projects(id) SET NULL).

---

## Browser Automation

### browser_profiles

| Column | Type | Constraints |
|--------|------|------------|
| `id` | UUID | PK, default random |
| `workspace_id` | UUID | NOT NULL, FK → workspaces(id) CASCADE |
| `name` | TEXT | NOT NULL |
| `profile_path` | TEXT | NOT NULL |
| `assigned_agent_id` | UUID | FK → agents(id) SET NULL |
| `os` | TEXT | NOT NULL, default 'windows' |
| `status` | browser_profile_status | NOT NULL, default 'active' |
| `created_at` | TIMESTAMP | NOT NULL, default NOW |
| `updated_at` | TIMESTAMP | NOT NULL, default NOW |

### browser_sessions

| Column | Type | Constraints |
|--------|------|------------|
| `id` | UUID | PK, default random |
| `workspace_id` | UUID | NOT NULL, FK → workspaces(id) CASCADE |
| `profile_id` | UUID | NOT NULL, FK → browser_profiles(id) CASCADE |
| `agent_id` | UUID | FK → agents(id) SET NULL |
| `task_id` | TEXT | Nullable (chat session ID) |
| `status` | browser_session_status | NOT NULL, default 'starting' |
| `closed_at` | TIMESTAMP | Nullable |
| `created_at` | TIMESTAMP | NOT NULL, default NOW |
| `updated_at` | TIMESTAMP | NOT NULL, default NOW |

### browser_proxies

| Column | Type | Constraints |
|--------|------|------------|
| `id` | UUID | PK, default random |
| `workspace_id` | UUID | NOT NULL, FK → workspaces(id) CASCADE |
| `label` | TEXT | NOT NULL |
| `host` | TEXT | NOT NULL |
| `port` | INTEGER | NOT NULL |
| `protocol` | proxy_protocol | NOT NULL, default 'http' |
| `username` | TEXT | Nullable |
| `password` | TEXT | Nullable |
| `test_status` | proxy_test_status | NOT NULL, default 'untested' |
| `test_ip` | TEXT | Nullable |
| `tested_at` | TIMESTAMP | Nullable |
| `created_at` | TIMESTAMP | NOT NULL, default NOW |
| `updated_at` | TIMESTAMP | NOT NULL, default NOW |

---

## Channels & Integrations

### integrations

| Column | Type | Constraints |
|--------|------|------------|
| `id` | UUID | PK, default random |
| `workspace_id` | UUID | NOT NULL, FK → workspaces(id) CASCADE |
| `name` | TEXT | NOT NULL |
| `toolkit_slug` | TEXT | NOT NULL |
| `connected_account_id` | TEXT | Nullable |
| `connection_label` | TEXT | NOT NULL |
| `connection_description` | TEXT | Nullable |
| `logo` | TEXT | Nullable |
| `status` | integration_status | NOT NULL, default 'pending' |
| `config` | JSONB | NOT NULL, default {} |
| `created_at` | TIMESTAMP | NOT NULL, default NOW |
| `updated_at` | TIMESTAMP | NOT NULL, default NOW |

### input_channels

| Column | Type | Constraints |
|--------|------|------------|
| `id` | UUID | PK, default random |
| `workspace_id` | UUID | NOT NULL, FK → workspaces(id) CASCADE |
| `agent_id` | UUID | NOT NULL, FK → agents(id) CASCADE |
| `channel_type` | channel_type | NOT NULL |
| `connection_id` | UUID | NOT NULL, FK → channel_connections(id) CASCADE |
| `config` | JSONB | NOT NULL, default {} |
| `created_at` | TIMESTAMP | NOT NULL, default NOW |
| `updated_at` | TIMESTAMP | NOT NULL, default NOW |

### channel_connections

| Column | Type | Constraints |
|--------|------|------------|
| `id` | UUID | PK, default random |
| `workspace_id` | UUID | NOT NULL, FK → workspaces(id) CASCADE |
| `channel_type` | channel_type | NOT NULL |
| `name` | TEXT | NOT NULL |
| `credentials` | JSONB | NOT NULL |
| `config` | JSONB | NOT NULL, default {} |
| `status` | connection_status | NOT NULL, default 'inactive' |
| `created_at` | TIMESTAMP | NOT NULL, default NOW |
| `updated_at` | TIMESTAMP | NOT NULL, default NOW |

---

## Vault

### vault_connections

| Column | Type | Constraints |
|--------|------|------------|
| `id` | UUID | PK, default random |
| `workspace_id` | UUID | NOT NULL, FK → workspaces(id) CASCADE |
| `provider` | vault_provider | NOT NULL |
| `encrypted_token` | TEXT | NOT NULL |
| `encrypted_vault_key` | TEXT | Nullable |
| `kdf_type` | INTEGER | Nullable |
| `kdf_iterations` | INTEGER | Nullable |
| `status` | vault_connection_status | NOT NULL, default 'active' |
| `last_sync_at` | TIMESTAMP | Nullable |
| `created_at` | TIMESTAMP | NOT NULL, default NOW |
| `updated_at` | TIMESTAMP | NOT NULL, default NOW |

### vault_audit_logs

| Column | Type | Constraints |
|--------|------|------------|
| `id` | UUID | PK, default random |
| `workspace_id` | UUID | NOT NULL, FK → workspaces(id) CASCADE |
| `connection_id` | UUID | NOT NULL, FK → vault_connections(id) CASCADE |
| `action` | vault_audit_action | NOT NULL |
| `metadata` | JSONB | Nullable |
| `created_at` | TIMESTAMP | NOT NULL, default NOW |
| `updated_at` | TIMESTAMP | NOT NULL, default NOW |

---

## Credits & Billing

### credits

| Column | Type | Constraints |
|--------|------|------------|
| `id` | UUID | PK, default random |
| `workspace_id` | UUID | NOT NULL, FK → workspaces(id) CASCADE, UNIQUE |
| `plan_credits` | INTEGER | NOT NULL, default 0 |
| `topup_credits` | INTEGER | NOT NULL, default 0 |
| `balance` | INTEGER | NOT NULL, default 0 |
| `overage_enabled` | BOOLEAN | NOT NULL, default false |
| `overage_limit` | INTEGER | NOT NULL, default 0 |
| `total_credits_consumed` | INTEGER | NOT NULL, default 0 |
| `created_at` | TIMESTAMP | NOT NULL, default NOW |
| `updated_at` | TIMESTAMP | NOT NULL, default NOW |

### credit_ledger

| Column | Type | Constraints |
|--------|------|------------|
| `id` | UUID | PK, default random |
| `workspace_id` | UUID | NOT NULL, FK → workspaces(id) CASCADE |
| `amount` | INTEGER | NOT NULL |
| `type` | ledger_type | NOT NULL |
| `credits_after` | INTEGER | NOT NULL |
| `metadata` | JSONB | Nullable |
| `created_at` | TIMESTAMP | NOT NULL, default NOW |
| `updated_at` | TIMESTAMP | NOT NULL, default NOW |

### credit_logs

| Column | Type | Constraints |
|--------|------|------------|
| `id` | UUID | PK, default random |
| `workspace_id` | UUID | NOT NULL, FK → workspaces(id) CASCADE |
| `tokens_used` | INTEGER | NOT NULL, default 0 |
| `credits_deducted` | INTEGER | NOT NULL, default 0 |
| `model` | TEXT | Nullable |
| `created_at` | TIMESTAMP | NOT NULL, default NOW |

---

## Files

### bucket_files

| Column | Type | Constraints |
|--------|------|------------|
| `id` | UUID | PK, default random |
| `workspace_id` | UUID | NOT NULL, FK → workspaces(id) CASCADE |
| `filename` | TEXT | NOT NULL |
| `storage_key` | TEXT | NOT NULL, UNIQUE |
| `mime_type` | TEXT | NOT NULL |
| `size_bytes` | BIGINT | NOT NULL |
| `folder` | TEXT | NOT NULL, default '/' |
| `source` | file_source | NOT NULL |
| `session_id` | UUID | FK → sessions(id) SET NULL |
| `agent_id` | UUID | FK → agents(id) SET NULL |
| `uploaded_by` | UUID | Nullable |
| `metadata` | JSONB | Nullable |
| `created_at` | TIMESTAMP | NOT NULL, default NOW |
| `updated_at` | TIMESTAMP | NOT NULL, default NOW |

---

## LLM Models

### llm_models

| Column | Type | Constraints |
|--------|------|------------|
| `id` | UUID | PK, default random |
| `model_id` | TEXT | NOT NULL, UNIQUE |
| `display_name` | TEXT | NOT NULL |
| `provider` | llm_provider | NOT NULL |
| `description` | TEXT | Nullable |
| `multiplier` | NUMERIC | NOT NULL, default 1.0 |
| `context_window` | INTEGER | NOT NULL, default 128000 |
| `is_active` | BOOLEAN | NOT NULL, default true |
| `minimum_plan` | plan_tier | NOT NULL, default 'free' |
| `is_featured` | BOOLEAN | NOT NULL, default false |
| `sort_order` | INTEGER | NOT NULL, default 0 |
| `created_at` | TIMESTAMP | NOT NULL, default NOW |
| `updated_at` | TIMESTAMP | NOT NULL, default NOW |

---

## Content

### blogs

| Column | Type | Constraints |
|--------|------|------------|
| `id` | UUID | PK, default random |
| `workspace_id` | UUID | FK → workspaces(id) CASCADE |
| `title` | TEXT | NOT NULL |
| `slug` | TEXT | NOT NULL, UNIQUE |
| `description` | TEXT | Nullable |
| `content` | TEXT | NOT NULL |
| `emoji` | TEXT | Nullable |
| `tag` | TEXT | Nullable |
| `cover_image` | TEXT | Nullable |
| `author` | TEXT | Nullable |
| `read_time` | TEXT | Nullable |
| `featured` | BOOLEAN | NOT NULL, default false |
| `published` | BOOLEAN | NOT NULL, default false |
| `published_at` | TIMESTAMP | Nullable |
| `created_at` | TIMESTAMP | NOT NULL, default NOW |
| `updated_at` | TIMESTAMP | NOT NULL, default NOW |

### contact_submissions

| Column | Type | Constraints |
|--------|------|------------|
| `id` | UUID | PK, default random |
| `name` | TEXT | NOT NULL |
| `email` | TEXT | NOT NULL |
| `subject` | TEXT | Nullable |
| `message` | TEXT | NOT NULL |
| `status` | TEXT | NOT NULL, default 'new' |
| `created_at` | TIMESTAMP | NOT NULL, default NOW |
| `updated_at` | TIMESTAMP | NOT NULL, default NOW |

---

## Key Relationships

### Cascade Deletes (parent → child)

```
workspaces → agents, sessions, knowledge_bases, schedules, tools, skills,
             integrations, input_channels, channel_connections, credits,
             credit_ledger, credit_logs, bucket_files, browser_profiles,
             browser_proxies, vault_connections, blogs

agents → sessions, schedules, agent_permissions, agent_integrations, agent_memories

sessions → messages, runs

knowledge_bases → kb_documents → kb_chunks

schedules → schedule_runs

browser_profiles → browser_sessions

vault_connections → vault_audit_logs

integrations → agent_integrations
```

### Set Null on Delete

```
agents.browser_proxy_id → browser_proxies (SET NULL)
browser_profiles.assigned_agent_id → agents (SET NULL)
browser_sessions.agent_id → agents (SET NULL)
bucket_files.session_id → sessions (SET NULL)
bucket_files.agent_id → agents (SET NULL)
```

---

## Next Steps

- [Deployment](./17-deployment.md) -- Docker setup and production configuration
