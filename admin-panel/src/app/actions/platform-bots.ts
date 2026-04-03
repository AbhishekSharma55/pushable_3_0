'use server';

import pool from '@/lib/db';
import { revalidatePath } from 'next/cache';

// ─── Types ──────────────────────────────────────────────────────────

export interface PlatformBotConfig {
  id: string;
  platform: string;
  config: Record<string, string>;
  config_masked: Record<string, string>;
  status: string;
  bot_name: string | null;
  bot_username: string | null;
  error_message: string | null;
  updated_at: string;
  updated_by: string | null;
}

// ─── Helpers ────────────────────────────────────────────────────────

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_bot_configs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      platform text NOT NULL UNIQUE,
      config jsonb NOT NULL DEFAULT '{}',
      status text NOT NULL DEFAULT 'inactive',
      bot_name text,
      bot_username text,
      error_message text,
      updated_at timestamp DEFAULT now() NOT NULL,
      updated_by text
    )
  `);
}

function maskValue(val: string | undefined): string {
  if (!val) return '';
  if (val.length <= 8) return '••••••••';
  return '••••••••' + val.slice(-4);
}

function maskConfig(config: Record<string, string>): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const [key, val] of Object.entries(config)) {
    masked[key] = maskValue(val);
  }
  return masked;
}

// ─── Queries ────────────────────────────────────────────────────────

export async function getPlatformBotConfigs(): Promise<PlatformBotConfig[]> {
  await ensureTable();
  const { rows } = await pool.query(`
    SELECT id, platform, config, status, bot_name, bot_username,
           error_message, updated_at, updated_by
    FROM platform_bot_configs
    ORDER BY platform ASC
  `);

  return rows.map((row: any) => ({
    id: row.id,
    platform: row.platform,
    status: row.status || 'inactive',
    bot_name: row.bot_name || null,
    bot_username: row.bot_username || null,
    error_message: row.error_message || null,
    updated_at: row.updated_at ? row.updated_at.toISOString() : null,
    updated_by: row.updated_by || null,
    config: row.config || {},
    config_masked: maskConfig(row.config || {}),
  }));
}

export async function upsertPlatformBotConfig(
  platform: string,
  config: Record<string, string>
): Promise<void> {
  await ensureTable();
  await pool.query(
    `
    INSERT INTO platform_bot_configs (platform, config, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (platform) DO UPDATE SET
      config = $2,
      updated_at = NOW()
    `,
    [platform, JSON.stringify(config)]
  );
  revalidatePath('/channel-config');
}

export async function testPlatformBotConnection(
  platform: string,
  config: Record<string, string>
): Promise<{ success: boolean; botName?: string; botUsername?: string; teamName?: string; error?: string }> {
  try {
    if (platform === 'telegram') {
      const token = config.botToken;
      if (!token) return { success: false, error: 'Bot token is required' };

      const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const data = await res.json();

      if (!data.ok) {
        return { success: false, error: data.description || 'Invalid bot token' };
      }

      return {
        success: true,
        botName: data.result.first_name,
        botUsername: data.result.username,
      };
    }

    if (platform === 'slack') {
      const token = config.botToken;
      if (!token) return { success: false, error: 'Bot token is required' };

      const res = await fetch('https://slack.com/api/auth.test', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      const data = await res.json();

      if (!data.ok) {
        return { success: false, error: data.error || 'Invalid Slack credentials' };
      }

      return {
        success: true,
        teamName: data.team,
        botUsername: data.user,
      };
    }

    return { success: false, error: 'Unknown platform' };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Connection failed' };
  }
}

export async function restartPlatformBot(
  platform: string
): Promise<{ success: boolean; status?: string; error?: string }> {
  try {
    const backendUrl = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
    const res = await fetch(`${backendUrl}/api/internal/platform-bots/${platform}/restart`);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { success: false, error: data.error || `Restart failed (${res.status})` };
    }

    const data = await res.json();
    revalidatePath('/channel-config');
    return { success: true, status: data.status };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to reach backend' };
  }
}
