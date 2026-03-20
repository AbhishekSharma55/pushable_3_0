'use server'

import pool from '@/lib/db'

export interface WorkspaceResource {
  workspace_id: string
  workspace_name: string
  owner_name: string
  owner_email: string
  // Credits
  credits_balance: number
  plan_credits: number
  topup_credits: number
  total_credits_consumed: number
  overage_enabled: boolean
  overage_limit: number
  // Counts
  agent_count: number
  session_count: number
  message_count: number
  kb_count: number
  kb_doc_count: number
  schedule_count: number
  member_count: number
  tool_count: number
  integration_count: number
}

export interface CreditLog {
  id: string
  workspace_name: string
  agent_name: string | null
  tokens_used: number
  credits_deducted: number
  model: string
  created_at: string
}

export interface LedgerEntry {
  id: string
  workspace_name: string
  amount: number
  type: string
  credits_after: number
  created_at: string
}

export interface RunEntry {
  id: string
  workspace_name: string
  session_title: string | null
  status: string
  error: string | null
  created_at: string
}

export interface ScheduleRunEntry {
  id: string
  schedule_name: string
  workspace_name: string
  status: string
  credits_used: number
  duration_ms: number | null
  started_at: string
  completed_at: string | null
}

export interface PlatformStats {
  total_workspaces: number
  total_users: number
  total_agents: number
  total_sessions: number
  total_messages: number
  total_runs: number
  total_credits_consumed: number
  total_credits_balance: number
  total_kb_documents: number
  total_schedules: number
  active_schedules: number
  total_integrations: number
}

export interface ModelUsage {
  model: string
  call_count: number
  total_tokens: number
  total_credits: number
}

export interface CreditsByType {
  type: string
  total_amount: number
  entry_count: number
}

export async function getPlatformStats(): Promise<PlatformStats> {
  const result = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM workspaces)::int AS total_workspaces,
      (SELECT COUNT(*) FROM users)::int AS total_users,
      (SELECT COUNT(*) FROM agents)::int AS total_agents,
      (SELECT COUNT(*) FROM sessions)::int AS total_sessions,
      (SELECT COUNT(*) FROM messages)::int AS total_messages,
      (SELECT COUNT(*) FROM runs)::int AS total_runs,
      (SELECT COALESCE(SUM(total_credits_consumed), 0) FROM credits)::int AS total_credits_consumed,
      (SELECT COALESCE(SUM(balance), 0) FROM credits)::int AS total_credits_balance,
      (SELECT COUNT(*) FROM kb_documents)::int AS total_kb_documents,
      (SELECT COUNT(*) FROM schedules)::int AS total_schedules,
      (SELECT COUNT(*) FROM schedules WHERE enabled = true)::int AS active_schedules,
      (SELECT COUNT(*) FROM integrations)::int AS total_integrations
  `)
  return result.rows[0]
}

export async function getWorkspaceResources(): Promise<WorkspaceResource[]> {
  const result = await pool.query(`
    SELECT
      w.id AS workspace_id,
      w.name AS workspace_name,
      u.name AS owner_name,
      u.email AS owner_email,
      COALESCE(c.balance, 0)::int AS credits_balance,
      COALESCE(c.plan_credits, 0)::int AS plan_credits,
      COALESCE(c.topup_credits, 0)::int AS topup_credits,
      COALESCE(c.total_credits_consumed, 0)::int AS total_credits_consumed,
      COALESCE(c.overage_enabled, false) AS overage_enabled,
      COALESCE(c.overage_limit, 0)::int AS overage_limit,
      (SELECT COUNT(*) FROM agents a WHERE a.workspace_id = w.id)::int AS agent_count,
      (SELECT COUNT(*) FROM sessions s WHERE s.workspace_id = w.id)::int AS session_count,
      (SELECT COUNT(*) FROM messages m WHERE m.workspace_id = w.id)::int AS message_count,
      (SELECT COUNT(*) FROM knowledge_bases kb WHERE kb.workspace_id = w.id)::int AS kb_count,
      (SELECT COUNT(*) FROM kb_documents kd WHERE kd.workspace_id = w.id)::int AS kb_doc_count,
      (SELECT COUNT(*) FROM schedules sc WHERE sc.workspace_id = w.id)::int AS schedule_count,
      (SELECT COUNT(*) FROM workspace_members wm WHERE wm.workspace_id = w.id)::int AS member_count,
      (SELECT COUNT(*) FROM tools t WHERE t.workspace_id = w.id)::int AS tool_count,
      (SELECT COUNT(*) FROM integrations i WHERE i.workspace_id = w.id)::int AS integration_count
    FROM workspaces w
    LEFT JOIN users u ON u.id = w.owner_id
    LEFT JOIN credits c ON c.workspace_id = w.id
    ORDER BY COALESCE(c.total_credits_consumed, 0) DESC
  `)
  return result.rows
}

export async function getRecentCreditLogs(): Promise<CreditLog[]> {
  const result = await pool.query(`
    SELECT
      cl.id,
      w.name AS workspace_name,
      ag.name AS agent_name,
      cl.tokens_used,
      cl.credits_deducted,
      cl.model,
      cl.created_at
    FROM credit_logs cl
    LEFT JOIN workspaces w ON w.id = cl.workspace_id
    LEFT JOIN agents ag ON ag.id = cl.agent_id
    ORDER BY cl.created_at DESC
    LIMIT 50
  `)
  return result.rows
}

export async function getRecentLedgerEntries(): Promise<LedgerEntry[]> {
  const result = await pool.query(`
    SELECT
      cl.id,
      w.name AS workspace_name,
      cl.amount,
      cl.type,
      cl.credits_after,
      cl.created_at
    FROM credit_ledger cl
    LEFT JOIN workspaces w ON w.id = cl.workspace_id
    ORDER BY cl.created_at DESC
    LIMIT 50
  `)
  return result.rows
}

export async function getRecentRuns(): Promise<RunEntry[]> {
  const result = await pool.query(`
    SELECT
      r.id,
      w.name AS workspace_name,
      s.title AS session_title,
      r.status,
      r.error,
      r.created_at
    FROM runs r
    LEFT JOIN workspaces w ON w.id = r.workspace_id
    LEFT JOIN sessions s ON s.id = r.session_id
    ORDER BY r.created_at DESC
    LIMIT 50
  `)
  return result.rows
}

export async function getRecentScheduleRuns(): Promise<ScheduleRunEntry[]> {
  const result = await pool.query(`
    SELECT
      sr.id,
      sc.name AS schedule_name,
      w.name AS workspace_name,
      sr.status,
      sr.credits_used,
      sr.duration_ms,
      sr.started_at,
      sr.completed_at
    FROM schedule_runs sr
    LEFT JOIN schedules sc ON sc.id = sr.schedule_id
    LEFT JOIN workspaces w ON w.id = sr.workspace_id
    ORDER BY sr.started_at DESC
    LIMIT 50
  `)
  return result.rows
}

export async function getModelUsage(): Promise<ModelUsage[]> {
  const result = await pool.query(`
    SELECT
      model,
      COUNT(*)::int AS call_count,
      COALESCE(SUM(tokens_used), 0)::int AS total_tokens,
      COALESCE(SUM(credits_deducted), 0)::int AS total_credits
    FROM credit_logs
    GROUP BY model
    ORDER BY total_credits DESC
  `)
  return result.rows
}

export async function getCreditsByType(): Promise<CreditsByType[]> {
  const result = await pool.query(`
    SELECT
      type,
      COALESCE(SUM(ABS(amount)), 0)::int AS total_amount,
      COUNT(*)::int AS entry_count
    FROM credit_ledger
    GROUP BY type
    ORDER BY total_amount DESC
  `)
  return result.rows
}
