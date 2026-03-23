'use server'

import pool from '@/lib/db'

// ─── LLM Models ─────────────────────────────────────────────────────

export interface LLMModel {
  id: string
  model_id: string
  display_name: string
  provider: string
  description: string | null
  multiplier: number
  context_window: number | null
  is_active: boolean
  minimum_plan: string
  is_featured: boolean
  sort_order: number
}

export async function getLLMModels(): Promise<LLMModel[]> {
  const { rows } = await pool.query(`
    SELECT id, model_id, display_name, provider, description,
           multiplier, context_window, is_active, minimum_plan,
           is_featured, sort_order
    FROM llm_models
    ORDER BY sort_order ASC, display_name ASC
  `)
  return rows
}

export async function createLLMModel(data: {
  model_id: string; display_name: string; provider: string; description?: string
  multiplier: number; context_window?: number; is_active: boolean
  minimum_plan: string; is_featured: boolean; sort_order: number
}) {
  await pool.query(`
    INSERT INTO llm_models (model_id, display_name, provider, description,
      multiplier, context_window, is_active, minimum_plan, is_featured, sort_order)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
  `, [data.model_id, data.display_name, data.provider, data.description || null,
      data.multiplier, data.context_window || null, data.is_active,
      data.minimum_plan, data.is_featured, data.sort_order])
}

export async function updateLLMModel(id: string, data: {
  model_id: string; display_name: string; provider: string; description?: string
  multiplier: number; context_window?: number; is_active: boolean
  minimum_plan: string; is_featured: boolean; sort_order: number
}) {
  await pool.query(`
    UPDATE llm_models SET model_id=$1, display_name=$2, provider=$3, description=$4,
      multiplier=$5, context_window=$6, is_active=$7, minimum_plan=$8,
      is_featured=$9, sort_order=$10, updated_at=now()
    WHERE id=$11
  `, [data.model_id, data.display_name, data.provider, data.description || null,
      data.multiplier, data.context_window || null, data.is_active,
      data.minimum_plan, data.is_featured, data.sort_order, id])
}

export async function deleteLLMModel(id: string) {
  await pool.query('DELETE FROM llm_models WHERE id = $1', [id])
}

export async function toggleLLMModel(id: string, is_active: boolean) {
  await pool.query('UPDATE llm_models SET is_active = $1, updated_at = now() WHERE id = $2', [is_active, id])
}

// ─── Service Health Checks ──────────────────────────────────────────

export interface ServiceStatus {
  name: string
  url: string
  status: 'online' | 'offline' | 'unknown'
  latency: number | null
}

export async function checkServiceHealth(): Promise<ServiceStatus[]> {
  const services = [
    { name: 'Backend API', url: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000' },
    { name: 'Browser Service', url: (process.env.BROWSER_SERVICE_URL || 'http://browser-service:8080') },
  ]

  const results: ServiceStatus[] = []

  for (const svc of services) {
    const start = Date.now()
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      const res = await fetch(`${svc.url}/`, { signal: controller.signal }).catch(() => null)
      clearTimeout(timeout)
      results.push({
        name: svc.name,
        url: svc.url,
        status: res ? 'online' : 'offline',
        latency: Date.now() - start,
      })
    } catch {
      results.push({ name: svc.name, url: svc.url, status: 'offline', latency: null })
    }
  }

  // Database check
  const dbStart = Date.now()
  try {
    await pool.query('SELECT 1')
    results.push({ name: 'PostgreSQL', url: 'postgres:5432', status: 'online', latency: Date.now() - dbStart })
  } catch {
    results.push({ name: 'PostgreSQL', url: 'postgres:5432', status: 'offline', latency: null })
  }

  return results
}

// ─── Environment Config (safe subset) ───────────────────────────────

export interface EnvConfig {
  gateway: string
  browserServiceUrl: string
  frontendUrl: string
  hasOpenRouterKey: boolean
  hasComposioKey: boolean
  hasClaudeToken: boolean
  databaseConnected: boolean
}

export async function getEnvConfig(): Promise<EnvConfig> {
  let dbConnected = false
  try {
    await pool.query('SELECT 1')
    dbConnected = true
  } catch { /* ignore */ }

  return {
    gateway: process.env.GATEWAY || 'OpenRouter',
    browserServiceUrl: process.env.BROWSER_SERVICE_URL || 'http://browser-service:8080',
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
    hasOpenRouterKey: !!process.env.OPENROUTER_KEY,
    hasComposioKey: !!process.env.COMPOSIO_API_KEY,
    hasClaudeToken: !!process.env.CLAUDE_ACCESS_TOKEN,
    databaseConnected: dbConnected,
  }
}

// ─── Browser Data ───────────────────────────────────────────────────

export interface BrowserProxy {
  id: string
  workspace_id: string
  workspace_name: string
  label: string
  host: string
  port: number
  username: string
  protocol: string
  country: string | null
  city: string | null
  is_active: boolean
  last_test_status: string
  last_tested_at: string | null
  created_at: string
}

export async function getBrowserProxies(): Promise<BrowserProxy[]> {
  try {
    const { rows } = await pool.query(`
      SELECT bp.id, bp.workspace_id, w.name as workspace_name,
             bp.label, bp.host, bp.port, bp.username, bp.protocol,
             bp.country, bp.city, bp.is_active,
             bp.last_test_status, bp.last_tested_at, bp.created_at
      FROM browser_proxies bp
      LEFT JOIN workspaces w ON w.id = bp.workspace_id
      ORDER BY bp.created_at DESC
    `)
    return rows
  } catch {
    return []
  }
}

export async function createBrowserProxy(data: {
  workspace_id?: string; label: string; host: string; port: number
  username: string; password: string; protocol: string
  country?: string; city?: string
}) {
  await pool.query(`
    INSERT INTO browser_proxies (workspace_id, label, host, port, username, password, protocol, country, city)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
  `, [data.workspace_id || null, data.label, data.host, data.port,
      data.username, data.password, data.protocol,
      data.country || null, data.city || null])
}

export async function deleteBrowserProxy(id: string) {
  await pool.query('DELETE FROM browser_proxies WHERE id = $1', [id])
}

export async function toggleBrowserProxy(id: string, is_active: boolean) {
  await pool.query('UPDATE browser_proxies SET is_active = $1, updated_at = now() WHERE id = $2', [is_active, id])
}

export interface BrowserProfile {
  id: string
  workspace_name: string
  name: string
  agent_name: string | null
  os: string
  status: string
  created_at: string
}

export async function getBrowserProfiles(): Promise<BrowserProfile[]> {
  try {
    const { rows } = await pool.query(`
      SELECT bp.id, w.name as workspace_name, bp.name,
             a.name as agent_name, bp.os, bp.status, bp.created_at
      FROM browser_profiles bp
      LEFT JOIN workspaces w ON w.id = bp.workspace_id
      LEFT JOIN agents a ON a.id = bp.assigned_agent_id
      ORDER BY bp.created_at DESC
    `)
    return rows
  } catch {
    return []
  }
}

export interface BrowserSession {
  id: string
  workspace_name: string
  profile_name: string
  agent_name: string | null
  status: string
  created_at: string
  closed_at: string | null
}

export async function getBrowserSessions(): Promise<BrowserSession[]> {
  try {
    const { rows } = await pool.query(`
      SELECT bs.id, w.name as workspace_name,
             bp.name as profile_name, a.name as agent_name,
             bs.status, bs.created_at, bs.closed_at
      FROM browser_sessions bs
      LEFT JOIN workspaces w ON w.id = bs.workspace_id
      LEFT JOIN browser_profiles bp ON bp.id = bs.profile_id
      LEFT JOIN agents a ON a.id = bs.agent_id
      ORDER BY bs.created_at DESC
      LIMIT 50
    `)
    return rows
  } catch {
    return []
  }
}

// ─── System Settings (browser agent model/prompt) ───────────────────

export interface SystemSettings {
  browser_agent_model: string
  browser_agent_prompt: string
}

async function ensureSystemSettingsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
}

export async function getSystemSettings(): Promise<SystemSettings> {
  try {
    await ensureSystemSettingsTable()
    const { rows } = await pool.query(`SELECT key, value FROM system_settings`)
    const map: Record<string, string> = {}
    for (const r of rows) map[r.key] = r.value
    return {
      browser_agent_model: map.browser_agent_model || 'google/gemini-3-flash-preview',
      browser_agent_prompt: map.browser_agent_prompt || '',
    }
  } catch {
    return { browser_agent_model: 'google/gemini-3-flash-preview', browser_agent_prompt: '' }
  }
}

export async function updateSystemSetting(key: string, value: string) {
  await ensureSystemSettingsTable()
  await pool.query(`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES ($1, $2, now())
    ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()
  `, [key, value])
}

// ─── Workspace Options (for proxy form) ─────────────────────────────

export async function getWorkspaceList(): Promise<{ id: string; name: string }[]> {
  const { rows } = await pool.query(`SELECT id, name FROM workspaces ORDER BY name ASC`)
  return rows
}

// ─── Agent Defaults Summary ─────────────────────────────────────────

export interface AgentDefaults {
  total_agents: number
  system_access_count: number
  approval_required_count: number
  can_manage_kb_count: number
  models_in_use: { model: string; count: number }[]
}

export async function getAgentDefaults(): Promise<AgentDefaults> {
  const [totals, models] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*)::int as total_agents,
        COUNT(*) FILTER (WHERE system_level_access = true)::int as system_access_count,
        COUNT(*) FILTER (WHERE require_approval_for_all = true)::int as approval_required_count,
        COUNT(*) FILTER (WHERE can_manage_kb = true)::int as can_manage_kb_count
      FROM agents
    `),
    pool.query(`
      SELECT model, COUNT(*)::int as count
      FROM agents
      GROUP BY model
      ORDER BY count DESC
      LIMIT 10
    `),
  ])

  return {
    ...totals.rows[0],
    models_in_use: models.rows,
  }
}

// ─── Integration Summary ────────────────────────────────────────────

export interface IntegrationSummary {
  toolkit_slug: string
  count: number
}

export async function getIntegrationSummary(): Promise<IntegrationSummary[]> {
  try {
    const { rows } = await pool.query(`
      SELECT composio_toolkit_slug as toolkit_slug, COUNT(*)::int as count
      FROM integrations
      GROUP BY composio_toolkit_slug
      ORDER BY count DESC
    `)
    return rows
  } catch {
    return []
  }
}
