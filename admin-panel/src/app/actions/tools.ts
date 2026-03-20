'use server'

import pool from '@/lib/db'
import { revalidatePath } from 'next/cache'

export interface AdminTool {
  id: string
  workspace_id: string | null
  workspace_name: string | null
  name: string
  description: string | null
  type: 'mcp' | 'function'
  config: Record<string, unknown>
  is_global: boolean
  requires_approval: boolean
  created_at: string
  updated_at: string
}

export async function getTools(): Promise<AdminTool[]> {
  const result = await pool.query(`
    SELECT
      t.id,
      t.workspace_id,
      w.name AS workspace_name,
      t.name,
      t.description,
      t.type,
      t.config,
      t.is_global,
      t.requires_approval,
      t.created_at,
      t.updated_at
    FROM tools t
    LEFT JOIN workspaces w ON w.id = t.workspace_id
    ORDER BY t.is_global DESC, t.created_at DESC
  `)
  return result.rows
}

export async function createTool(data: {
  name: string
  description: string
  type: 'mcp' | 'function'
  config: string
  is_global: boolean
  requires_approval: boolean
  workspace_id: string | null
}) {
  let parsedConfig = {}
  try {
    parsedConfig = data.config ? JSON.parse(data.config) : {}
  } catch {
    throw new Error('Invalid JSON in config')
  }

  await pool.query(
    `INSERT INTO tools (name, description, type, config, is_global, requires_approval, workspace_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [data.name, data.description || null, data.type, JSON.stringify(parsedConfig), data.is_global, data.requires_approval, data.workspace_id]
  )
  revalidatePath('/tools')
}

export async function updateTool(id: string, data: {
  name: string
  description: string
  type: 'mcp' | 'function'
  config: string
  is_global: boolean
  requires_approval: boolean
  workspace_id: string | null
}) {
  let parsedConfig = {}
  try {
    parsedConfig = data.config ? JSON.parse(data.config) : {}
  } catch {
    throw new Error('Invalid JSON in config')
  }

  await pool.query(
    `UPDATE tools SET name = $1, description = $2, type = $3, config = $4, is_global = $5, requires_approval = $6, workspace_id = $7, updated_at = NOW()
     WHERE id = $8`,
    [data.name, data.description || null, data.type, JSON.stringify(parsedConfig), data.is_global, data.requires_approval, data.workspace_id, id]
  )
  revalidatePath('/tools')
}

export async function deleteTool(id: string) {
  await pool.query(`DELETE FROM agent_permissions WHERE resource_type = 'tool' AND resource_id = $1`, [id])
  await pool.query(`DELETE FROM tools WHERE id = $1`, [id])
  revalidatePath('/tools')
}

export interface WorkspaceOption {
  id: string
  name: string
}

export async function getWorkspaceOptions(): Promise<WorkspaceOption[]> {
  const result = await pool.query(`SELECT id, name FROM workspaces ORDER BY name`)
  return result.rows
}
