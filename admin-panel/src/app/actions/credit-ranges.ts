'use server';

import pool from '@/lib/db';
import { revalidatePath } from 'next/cache';

export interface CreditCostRange {
  id: string;
  min_dollar: number;
  max_dollar: number;
  credit_amount: number;
  label: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export async function getCreditCostRanges(): Promise<CreditCostRange[]> {
  // Ensure table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS credit_cost_ranges (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      min_dollar NUMERIC(10, 6) NOT NULL,
      max_dollar NUMERIC(10, 6) NOT NULL,
      credit_amount NUMERIC(8, 4) NOT NULL,
      label TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT valid_range CHECK (max_dollar > min_dollar),
      CONSTRAINT positive_credits CHECK (credit_amount >= 0)
    )
  `);

  const { rows } = await pool.query(`
    SELECT id, min_dollar::float, max_dollar::float, credit_amount::float,
           label, sort_order, is_active, created_at, updated_at
    FROM credit_cost_ranges
    ORDER BY sort_order ASC, min_dollar ASC
  `);
  return rows;
}

export async function createCreditCostRange(data: {
  min_dollar: number;
  max_dollar: number;
  credit_amount: number;
  label?: string;
  sort_order: number;
  is_active: boolean;
}) {
  await pool.query(
    `INSERT INTO credit_cost_ranges (min_dollar, max_dollar, credit_amount, label, sort_order, is_active)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [data.min_dollar, data.max_dollar, data.credit_amount, data.label || null, data.sort_order, data.is_active],
  );
  revalidatePath('/credit-ranges');
}

export async function updateCreditCostRange(
  id: string,
  data: {
    min_dollar: number;
    max_dollar: number;
    credit_amount: number;
    label?: string;
    sort_order: number;
    is_active: boolean;
  },
) {
  await pool.query(
    `UPDATE credit_cost_ranges
     SET min_dollar = $1, max_dollar = $2, credit_amount = $3,
         label = $4, sort_order = $5, is_active = $6, updated_at = now()
     WHERE id = $7`,
    [data.min_dollar, data.max_dollar, data.credit_amount, data.label || null, data.sort_order, data.is_active, id],
  );
  revalidatePath('/credit-ranges');
}

export async function deleteCreditCostRange(id: string) {
  await pool.query(`DELETE FROM credit_cost_ranges WHERE id = $1`, [id]);
  revalidatePath('/credit-ranges');
}

export async function toggleCreditCostRange(id: string, is_active: boolean) {
  await pool.query(
    `UPDATE credit_cost_ranges SET is_active = $1, updated_at = now() WHERE id = $2`,
    [is_active, id],
  );
  revalidatePath('/credit-ranges');
}

// ─── Credit Cost Multipliers ────────────────────────────────────────

export interface CreditCostMultiplier {
  id: string;
  above_dollar: number;
  multiplier: number;
  label: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export async function getCreditCostMultipliers(): Promise<CreditCostMultiplier[]> {
  // Ensure table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS credit_cost_multipliers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      above_dollar NUMERIC(10, 6) NOT NULL,
      multiplier NUMERIC(10, 4) NOT NULL,
      label TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT positive_threshold CHECK (above_dollar >= 0),
      CONSTRAINT positive_multiplier CHECK (multiplier > 0)
    )
  `);

  const { rows } = await pool.query(`
    SELECT id, above_dollar::float, multiplier::float,
           label, sort_order, is_active, created_at, updated_at
    FROM credit_cost_multipliers
    ORDER BY sort_order ASC, above_dollar ASC
  `);
  return rows;
}

export async function createCreditCostMultiplier(data: {
  above_dollar: number;
  multiplier: number;
  label?: string;
  sort_order: number;
  is_active: boolean;
}) {
  await pool.query(
    `INSERT INTO credit_cost_multipliers (above_dollar, multiplier, label, sort_order, is_active)
     VALUES ($1, $2, $3, $4, $5)`,
    [data.above_dollar, data.multiplier, data.label || null, data.sort_order, data.is_active],
  );
  revalidatePath('/credit-ranges');
}

export async function updateCreditCostMultiplier(
  id: string,
  data: {
    above_dollar: number;
    multiplier: number;
    label?: string;
    sort_order: number;
    is_active: boolean;
  },
) {
  await pool.query(
    `UPDATE credit_cost_multipliers
     SET above_dollar = $1, multiplier = $2,
         label = $3, sort_order = $4, is_active = $5, updated_at = now()
     WHERE id = $6`,
    [data.above_dollar, data.multiplier, data.label || null, data.sort_order, data.is_active, id],
  );
  revalidatePath('/credit-ranges');
}

export async function deleteCreditCostMultiplier(id: string) {
  await pool.query(`DELETE FROM credit_cost_multipliers WHERE id = $1`, [id]);
  revalidatePath('/credit-ranges');
}

export async function toggleCreditCostMultiplier(id: string, is_active: boolean) {
  await pool.query(
    `UPDATE credit_cost_multipliers SET is_active = $1, updated_at = now() WHERE id = $2`,
    [is_active, id],
  );
  revalidatePath('/credit-ranges');
}
