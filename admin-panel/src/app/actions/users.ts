'use server'

import pool from '@/lib/db'
import bcrypt from 'bcryptjs'
import { revalidatePath } from 'next/cache'

export interface AdminUser {
  id: string
  name: string
  email: string
  created_at: string
  blocked_at: string | null
  role: string | null
  workspace_name: string | null
  workspace_id: string | null
  credits_balance: number | null
  total_credits_consumed: number | null
  plan_credits: number | null
  topup_credits: number | null
}

async function ensureBlockedAtColumn() {
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ DEFAULT NULL
  `)
}

export async function getUsers(): Promise<AdminUser[]> {
  await ensureBlockedAtColumn()

  const result = await pool.query(`
    SELECT
      u.id,
      u.name,
      u.email,
      u.created_at,
      u.blocked_at,
      wm.role,
      w.name  AS workspace_name,
      w.id    AS workspace_id,
      c.balance               AS credits_balance,
      c.total_credits_consumed,
      c.plan_credits,
      c.topup_credits
    FROM users u
    LEFT JOIN LATERAL (
      SELECT workspace_id, role
      FROM workspace_members
      WHERE user_id = u.id
      ORDER BY created_at ASC
      LIMIT 1
    ) wm ON true
    LEFT JOIN workspaces w ON w.id = wm.workspace_id
    LEFT JOIN credits c ON c.workspace_id = w.id
    ORDER BY u.created_at DESC
  `)

  return result.rows
}

export async function blockUser(userId: string) {
  await ensureBlockedAtColumn()
  await pool.query(`UPDATE users SET blocked_at = NOW() WHERE id = $1`, [userId])
  revalidatePath('/users')
}

export async function unblockUser(userId: string) {
  await ensureBlockedAtColumn()
  await pool.query(`UPDATE users SET blocked_at = NULL WHERE id = $1`, [userId])
  revalidatePath('/users')
}

export async function updateUser(
  userId: string,
  data: { name?: string; email?: string; role?: string }
) {
  const fields: string[] = []
  const values: unknown[] = []
  let i = 1

  if (data.name !== undefined) {
    fields.push(`name = $${i++}`)
    values.push(data.name)
  }
  if (data.email !== undefined) {
    fields.push(`email = $${i++}`)
    values.push(data.email)
  }

  if (fields.length > 0) {
    values.push(userId)
    await pool.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${i}`,
      values
    )
  }

  if (data.role !== undefined) {
    await pool.query(
      `UPDATE workspace_members SET role = $1 WHERE user_id = $2`,
      [data.role, userId]
    )
  }

  revalidatePath('/users')
}

export async function resetPassword(userId: string, newPassword: string) {
  const passwordHash = await bcrypt.hash(newPassword, 12)
  const result = await pool.query(
    `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
    [passwordHash, userId]
  )
  if (result.rowCount === 0) {
    throw new Error('User not found')
  }
  revalidatePath('/users')
}

export async function deleteUser(userId: string) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Get workspaces owned by this user
    const owned = await client.query(
      `SELECT id FROM workspaces WHERE owner_id = $1`, [userId]
    )
    const ownedIds = owned.rows.map((r: { id: string }) => r.id)

    if (ownedIds.length > 0) {
      // Delete all workspace-dependent data for owned workspaces
      for (const wid of ownedIds) {
        await client.query(`DELETE FROM credit_ledger WHERE workspace_id = $1`, [wid])
        await client.query(`DELETE FROM credit_logs WHERE workspace_id = $1`, [wid])
        await client.query(`DELETE FROM credits WHERE workspace_id = $1`, [wid])
        await client.query(`DELETE FROM schedule_runs WHERE workspace_id = $1`, [wid])
        await client.query(`DELETE FROM schedules WHERE workspace_id = $1`, [wid])
        await client.query(`DELETE FROM kb_chunks WHERE workspace_id = $1`, [wid])
        await client.query(`DELETE FROM kb_documents WHERE workspace_id = $1`, [wid])
        await client.query(`DELETE FROM knowledge_bases WHERE workspace_id = $1`, [wid])
        await client.query(`DELETE FROM messages WHERE workspace_id = $1`, [wid])
        await client.query(`DELETE FROM runs WHERE workspace_id = $1`, [wid])
        await client.query(`DELETE FROM sessions WHERE workspace_id = $1`, [wid])
        await client.query(`DELETE FROM agent_integrations WHERE workspace_id = $1`, [wid])
        await client.query(`DELETE FROM agent_permissions WHERE workspace_id = $1`, [wid])
        await client.query(`DELETE FROM agent_memories WHERE workspace_id = $1`, [wid])
        await client.query(`DELETE FROM input_channels WHERE workspace_id = $1`, [wid])
        await client.query(`DELETE FROM channel_connections WHERE workspace_id = $1`, [wid])
        await client.query(`DELETE FROM browser_sessions WHERE workspace_id = $1`, [wid])
        await client.query(`DELETE FROM browser_profiles WHERE workspace_id = $1`, [wid])
        await client.query(`DELETE FROM browser_proxies WHERE workspace_id = $1`, [wid])
        await client.query(`DELETE FROM integrations WHERE workspace_id = $1`, [wid])
        await client.query(`DELETE FROM skills WHERE workspace_id = $1`, [wid])
        await client.query(`DELETE FROM tools WHERE workspace_id = $1`, [wid])
        await client.query(`DELETE FROM agents WHERE workspace_id = $1`, [wid])
        await client.query(`DELETE FROM workspace_members WHERE workspace_id = $1`, [wid])
      }
      await client.query(`DELETE FROM workspaces WHERE owner_id = $1`, [userId])
    }

    // Remove membership from non-owned workspaces
    await client.query(`DELETE FROM workspace_members WHERE user_id = $1`, [userId])

    // Delete the user
    await client.query(`DELETE FROM users WHERE id = $1`, [userId])

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
  revalidatePath('/users')
}
