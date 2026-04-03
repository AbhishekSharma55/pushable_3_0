'use client'

import * as React from 'react'
import {
  Plus, Trash2, X, Save, Edit2, ToggleLeft, ToggleRight, DollarSign, AlertTriangle, TrendingUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  createCreditCostRange, updateCreditCostRange, deleteCreditCostRange, toggleCreditCostRange,
  createCreditCostMultiplier, updateCreditCostMultiplier, deleteCreditCostMultiplier, toggleCreditCostMultiplier,
} from '@/app/actions/credit-ranges'
import type { CreditCostRange, CreditCostMultiplier } from '@/app/actions/credit-ranges'

// ─── Helpers ────────────────────────────────────────────────────────

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12px] font-medium text-muted-foreground mb-1">{label}</label>
      {children}
    </div>
  )
}

const inputCls = 'w-full rounded-lg border bg-background px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-foreground/20'

function fmtDollar(val: number) {
  return `$${val.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`
}

function ActiveToggle({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors',
        active
          ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
          : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200',
      )}
    >
      {active ? <ToggleRight className="size-3" /> : <ToggleLeft className="size-3" />}
      {active ? 'Active' : 'Inactive'}
    </button>
  )
}

// ═══════════════════════════════════════════════════════════════════
// RANGES SECTION
// ═══════════════════════════════════════════════════════════════════

interface RangeForm {
  min_dollar: string; max_dollar: string; credit_amount: string; label: string; sort_order: string; is_active: boolean
}
const emptyRangeForm: RangeForm = { min_dollar: '', max_dollar: '', credit_amount: '', label: '', sort_order: '0', is_active: true }

function RangesSection({ initialRanges }: { initialRanges: CreditCostRange[] }) {
  const [ranges, setRanges] = React.useState(initialRanges)
  const [showForm, setShowForm] = React.useState(false)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [form, setForm] = React.useState<RangeForm>(emptyRangeForm)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const overlaps = React.useMemo(() => {
    const active = ranges.filter(r => r.is_active).sort((a, b) => a.min_dollar - b.min_dollar)
    const issues: string[] = []
    for (let i = 0; i < active.length - 1; i++) {
      if (active[i].max_dollar > active[i + 1].min_dollar) {
        issues.push(`"${active[i].label || fmtDollar(active[i].min_dollar)}" overlaps with "${active[i + 1].label || fmtDollar(active[i + 1].min_dollar)}"`)
      }
    }
    return issues
  }, [ranges])

  function openCreate() { setEditingId(null); setForm(emptyRangeForm); setShowForm(true); setError(null) }
  function openEdit(r: CreditCostRange) {
    setEditingId(r.id)
    setForm({ min_dollar: String(r.min_dollar), max_dollar: String(r.max_dollar), credit_amount: String(r.credit_amount), label: r.label || '', sort_order: String(r.sort_order), is_active: r.is_active })
    setShowForm(true); setError(null)
  }
  function closeForm() { setShowForm(false); setEditingId(null); setForm(emptyRangeForm); setError(null) }

  async function handleSave() {
    const minD = parseFloat(form.min_dollar), maxD = parseFloat(form.max_dollar), creditAmt = parseFloat(form.credit_amount), sortOrd = parseInt(form.sort_order) || 0
    if (isNaN(minD) || isNaN(maxD) || isNaN(creditAmt)) { setError('All numeric fields are required'); return }
    if (maxD <= minD) { setError('Max dollar must be greater than min dollar'); return }
    if (creditAmt < 0) { setError('Credit amount must be >= 0'); return }
    setSaving(true); setError(null)
    try {
      const data = { min_dollar: minD, max_dollar: maxD, credit_amount: creditAmt, label: form.label || undefined, sort_order: sortOrd, is_active: form.is_active }
      if (editingId) {
        await updateCreditCostRange(editingId, data)
        setRanges(prev => prev.map(r => r.id === editingId ? { ...r, ...data, label: data.label || null, updated_at: new Date().toISOString() } : r))
      } else {
        await createCreditCostRange(data)
        window.location.reload()
      }
      closeForm()
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Failed to save') }
    finally { setSaving(false) }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this credit range?')) return
    try { await deleteCreditCostRange(id); setRanges(prev => prev.filter(r => r.id !== id)) }
    catch (err: unknown) { alert(err instanceof Error ? err.message : 'Failed to delete') }
  }

  async function handleToggle(id: string, currentActive: boolean) {
    try { await toggleCreditCostRange(id, !currentActive); setRanges(prev => prev.map(r => r.id === id ? { ...r, is_active: !currentActive } : r)) }
    catch (err: unknown) { alert(err instanceof Error ? err.message : 'Failed to toggle') }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-blue-50">
            <DollarSign className="size-4.5 text-blue-600" />
          </div>
          <div>
            <h2 className="text-[15px] font-semibold">Cost Ranges</h2>
            <p className="text-[12px] text-muted-foreground">Fixed credit amounts for specific dollar cost ranges</p>
          </div>
        </div>
        <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-lg bg-foreground px-3 py-1.5 text-[12px] font-medium text-background transition-colors hover:bg-foreground/90">
          <Plus className="size-3.5" /> Add Range
        </button>
      </div>

      {/* Overlap warning */}
      {overlaps.length > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <span className="font-medium">Overlapping ranges:</span>
            <ul className="mt-1 list-disc pl-4">{overlaps.map((o, i) => <li key={i}>{o}</li>)}</ul>
          </div>
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="mb-4 rounded-lg border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[13px] font-semibold">{editingId ? 'Edit Range' : 'New Range'}</h3>
            <button onClick={closeForm} className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X className="size-4" /></button>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <FormField label="Min Dollar ($)">
              <input type="number" step="0.000001" className={inputCls} value={form.min_dollar} onChange={e => setForm(f => ({ ...f, min_dollar: e.target.value }))} placeholder="0.00" />
            </FormField>
            <FormField label="Max Dollar ($)">
              <input type="number" step="0.000001" className={inputCls} value={form.max_dollar} onChange={e => setForm(f => ({ ...f, max_dollar: e.target.value }))} placeholder="0.10" />
            </FormField>
            <FormField label="Credits to Deduct">
              <input type="number" step="0.0001" className={inputCls} value={form.credit_amount} onChange={e => setForm(f => ({ ...f, credit_amount: e.target.value }))} placeholder="0.25" />
            </FormField>
            <FormField label="Label (optional)">
              <input type="text" className={inputCls} value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="Small query" />
            </FormField>
            <FormField label="Sort Order">
              <input type="number" className={inputCls} value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))} />
            </FormField>
            <FormField label="Active">
              <button type="button" onClick={() => setForm(f => ({ ...f, is_active: !f.is_active }))}
                className={cn('mt-1 inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors', form.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-500')}>
                {form.is_active ? <ToggleRight className="size-4" /> : <ToggleLeft className="size-4" />}
                {form.is_active ? 'Active' : 'Inactive'}
              </button>
            </FormField>
          </div>
          {error && <p className="mt-2 text-[12px] font-medium text-red-600">{error}</p>}
          <div className="mt-3 flex gap-2">
            <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-foreground px-3 py-1.5 text-[12px] font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50">
              <Save className="size-3.5" /> {saving ? 'Saving...' : editingId ? 'Update' : 'Create'}
            </button>
            <button onClick={closeForm} className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-muted">Cancel</button>
          </div>
        </div>
      )}

      {/* Table */}
      {ranges.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <DollarSign className="size-8 text-muted-foreground/40" />
          <p className="mt-3 text-[13px] text-muted-foreground">No ranges configured. The system will use multipliers or the default formula.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Label</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Min Dollar</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Max Dollar</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Credits</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {ranges.map(r => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-2.5 font-medium">{r.label || <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-4 py-2.5 font-mono text-[12px]">{fmtDollar(r.min_dollar)}</td>
                  <td className="px-4 py-2.5 font-mono text-[12px]">{fmtDollar(r.max_dollar)}</td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-[12px] font-semibold text-blue-700">{r.credit_amount}</span>
                  </td>
                  <td className="px-4 py-2.5"><ActiveToggle active={r.is_active} onClick={() => handleToggle(r.id, r.is_active)} /></td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="inline-flex gap-1">
                      <button onClick={() => openEdit(r)} className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" title="Edit"><Edit2 className="size-3.5" /></button>
                      <button onClick={() => handleDelete(r.id)} className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600" title="Delete"><Trash2 className="size-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// MULTIPLIERS SECTION
// ═══════════════════════════════════════════════════════════════════

interface MultiplierForm {
  above_dollar: string; multiplier: string; label: string; sort_order: string; is_active: boolean
}
const emptyMultiplierForm: MultiplierForm = { above_dollar: '', multiplier: '', label: '', sort_order: '0', is_active: true }

function MultipliersSection({ initialMultipliers }: { initialMultipliers: CreditCostMultiplier[] }) {
  const [multipliers, setMultipliers] = React.useState(initialMultipliers)
  const [showForm, setShowForm] = React.useState(false)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [form, setForm] = React.useState<MultiplierForm>(emptyMultiplierForm)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  function openCreate() { setEditingId(null); setForm(emptyMultiplierForm); setShowForm(true); setError(null) }
  function openEdit(m: CreditCostMultiplier) {
    setEditingId(m.id)
    setForm({ above_dollar: String(m.above_dollar), multiplier: String(m.multiplier), label: m.label || '', sort_order: String(m.sort_order), is_active: m.is_active })
    setShowForm(true); setError(null)
  }
  function closeForm() { setShowForm(false); setEditingId(null); setForm(emptyMultiplierForm); setError(null) }

  async function handleSave() {
    const aboveD = parseFloat(form.above_dollar), mult = parseFloat(form.multiplier), sortOrd = parseInt(form.sort_order) || 0
    if (isNaN(aboveD) || isNaN(mult)) { setError('All numeric fields are required'); return }
    if (aboveD < 0) { setError('Threshold must be >= 0'); return }
    if (mult <= 0) { setError('Multiplier must be > 0'); return }
    setSaving(true); setError(null)
    try {
      const data = { above_dollar: aboveD, multiplier: mult, label: form.label || undefined, sort_order: sortOrd, is_active: form.is_active }
      if (editingId) {
        await updateCreditCostMultiplier(editingId, data)
        setMultipliers(prev => prev.map(m => m.id === editingId ? { ...m, ...data, label: data.label || null, updated_at: new Date().toISOString() } : m))
      } else {
        await createCreditCostMultiplier(data)
        window.location.reload()
      }
      closeForm()
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Failed to save') }
    finally { setSaving(false) }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this multiplier tier?')) return
    try { await deleteCreditCostMultiplier(id); setMultipliers(prev => prev.filter(m => m.id !== id)) }
    catch (err: unknown) { alert(err instanceof Error ? err.message : 'Failed to delete') }
  }

  async function handleToggle(id: string, currentActive: boolean) {
    try { await toggleCreditCostMultiplier(id, !currentActive); setMultipliers(prev => prev.map(m => m.id === id ? { ...m, is_active: !currentActive } : m)) }
    catch (err: unknown) { alert(err instanceof Error ? err.message : 'Failed to toggle') }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-purple-50">
            <TrendingUp className="size-4.5 text-purple-600" />
          </div>
          <div>
            <h2 className="text-[15px] font-semibold">Cost Multipliers</h2>
            <p className="text-[12px] text-muted-foreground">When cost exceeds all ranges, apply: dollar_cost &times; multiplier = credits</p>
          </div>
        </div>
        <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-lg bg-foreground px-3 py-1.5 text-[12px] font-medium text-background transition-colors hover:bg-foreground/90">
          <Plus className="size-3.5" /> Add Multiplier
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="mb-4 rounded-lg border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[13px] font-semibold">{editingId ? 'Edit Multiplier' : 'New Multiplier'}</h3>
            <button onClick={closeForm} className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X className="size-4" /></button>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <FormField label="Above Dollar ($)">
              <input type="number" step="0.000001" className={inputCls} value={form.above_dollar} onChange={e => setForm(f => ({ ...f, above_dollar: e.target.value }))} placeholder="1.00" />
            </FormField>
            <FormField label="Multiplier (x)">
              <input type="number" step="0.0001" className={inputCls} value={form.multiplier} onChange={e => setForm(f => ({ ...f, multiplier: e.target.value }))} placeholder="5" />
            </FormField>
            <FormField label="Label (optional)">
              <input type="text" className={inputCls} value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="High cost tier" />
            </FormField>
            <FormField label="Sort Order">
              <input type="number" className={inputCls} value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))} />
            </FormField>
            <FormField label="Active">
              <button type="button" onClick={() => setForm(f => ({ ...f, is_active: !f.is_active }))}
                className={cn('mt-1 inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors', form.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-500')}>
                {form.is_active ? <ToggleRight className="size-4" /> : <ToggleLeft className="size-4" />}
                {form.is_active ? 'Active' : 'Inactive'}
              </button>
            </FormField>
          </div>
          {error && <p className="mt-2 text-[12px] font-medium text-red-600">{error}</p>}
          <div className="mt-3 flex gap-2">
            <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-foreground px-3 py-1.5 text-[12px] font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50">
              <Save className="size-3.5" /> {saving ? 'Saving...' : editingId ? 'Update' : 'Create'}
            </button>
            <button onClick={closeForm} className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-muted">Cancel</button>
          </div>
        </div>
      )}

      {/* Table */}
      {multipliers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <TrendingUp className="size-8 text-muted-foreground/40" />
          <p className="mt-3 text-[13px] text-muted-foreground">No multipliers configured. Costs beyond ranges will fall back to the default formula.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Label</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Above Dollar</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Multiplier</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Example</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {multipliers.map(m => {
                const exampleCost = m.above_dollar * 1.5 || 1
                const exampleCredits = (exampleCost * m.multiplier).toFixed(2)
                return (
                  <tr key={m.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5 font-medium">{m.label || <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-4 py-2.5 font-mono text-[12px]">{fmtDollar(m.above_dollar)}</td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center rounded-full bg-purple-50 px-2.5 py-0.5 text-[12px] font-semibold text-purple-700">{m.multiplier}x</span>
                    </td>
                    <td className="px-4 py-2.5 text-[12px] text-muted-foreground">
                      {fmtDollar(exampleCost)} &times; {m.multiplier} = <span className="font-medium text-foreground">{exampleCredits} credits</span>
                    </td>
                    <td className="px-4 py-2.5"><ActiveToggle active={m.is_active} onClick={() => handleToggle(m.id, m.is_active)} /></td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="inline-flex gap-1">
                        <button onClick={() => openEdit(m)} className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" title="Edit"><Edit2 className="size-3.5" /></button>
                        <button onClick={() => handleDelete(m.id)} className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600" title="Delete"><Trash2 className="size-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════

export function CreditRangesClient({ initialRanges, initialMultipliers }: {
  initialRanges: CreditCostRange[]
  initialMultipliers: CreditCostMultiplier[]
}) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Page Header */}
      <div className="border-b px-6 py-5">
        <h1 className="text-[18px] font-semibold tracking-tight">Credit Cost Configuration</h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Configure how LLM dollar costs are converted to credit deductions.
        </p>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-8">
        {/* Ranges Section */}
        <RangesSection initialRanges={initialRanges} />

        {/* Divider */}
        <div className="h-px bg-border" />

        {/* Multipliers Section */}
        <MultipliersSection initialMultipliers={initialMultipliers} />

        {/* Info box */}
        <div className="rounded-lg border bg-muted/30 p-4 text-[12px] text-muted-foreground">
          <p className="font-medium text-foreground">How credit deduction works:</p>
          <ol className="mt-2 list-decimal pl-4 space-y-1">
            <li><span className="font-medium text-foreground">Ranges first:</span> If the dollar cost falls within a configured range (min &le; cost &lt; max), the fixed credit amount for that range is deducted.</li>
            <li><span className="font-medium text-foreground">Multipliers second:</span> If no range matches, the system checks multiplier tiers. The highest matching threshold applies: <code className="rounded bg-muted px-1 py-0.5">credits = dollar_cost &times; multiplier</code>.</li>
            <li><span className="font-medium text-foreground">Default fallback:</span> If neither ranges nor multipliers match, the old formula is used: <code className="rounded bg-muted px-1 py-0.5">base_cost &times; model_multiplier</code>.</li>
          </ol>
          <div className="mt-3 rounded-md bg-background border p-3">
            <p className="font-medium text-foreground mb-1">Example configuration:</p>
            <div className="space-y-0.5">
              <p>Range: $0 – $0.01 &rarr; 0.10 credits</p>
              <p>Range: $0.01 – $0.10 &rarr; 0.25 credits</p>
              <p>Range: $0.10 – $1.00 &rarr; 3 credits</p>
              <p>Multiplier: Above $1.00 &rarr; 5x &rarr; ($2.50 cost = 12.5 credits)</p>
              <p>Multiplier: Above $10.00 &rarr; 10x &rarr; ($50 cost = 500 credits)</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
