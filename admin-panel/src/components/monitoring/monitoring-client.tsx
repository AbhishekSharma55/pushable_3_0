'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  Users, Bot, MessageSquare, Coins, Database, Calendar,
  Play, Zap, ArrowUpRight, ArrowDownRight, Building2,
  Clock, AlertCircle, CheckCircle2, XCircle, Pause,
  FileText, Plug, Wrench, ChevronDown, ChevronUp,
  Server, Cpu, HardDrive, Network, Container, RefreshCw, Activity,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type {
  PlatformStats, WorkspaceResource, CreditLog,
  LedgerEntry, RunEntry, ScheduleRunEntry, ModelUsage, CreditsByType,
} from '@/app/actions/monitoring'

// ─── Helpers ────────────────────────────────────────────────────────

function fmtNum(n: number) { return n.toLocaleString() }

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function fmtDuration(ms: number | null) {
  if (!ms) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function pct(used: number, total: number) {
  if (!total) return 0
  return Math.min(Math.round((used / total) * 100), 100)
}

function statusColor(status: string) {
  switch (status) {
    case 'completed': return 'text-emerald-600 bg-emerald-50'
    case 'running': case 'in_progress': return 'text-blue-600 bg-blue-50'
    case 'queued': return 'text-amber-600 bg-amber-50'
    case 'failed': case 'error': return 'text-red-600 bg-red-50'
    case 'cancelled': case 'interrupted': case 'skipped': return 'text-zinc-500 bg-zinc-100'
    default: return 'text-zinc-500 bg-zinc-100'
  }
}

function statusIcon(status: string) {
  switch (status) {
    case 'completed': return <CheckCircle2 className="size-3.5" />
    case 'running': case 'in_progress': return <Play className="size-3.5" />
    case 'queued': return <Clock className="size-3.5" />
    case 'failed': case 'error': return <XCircle className="size-3.5" />
    case 'cancelled': case 'interrupted': case 'skipped': return <Pause className="size-3.5" />
    default: return <AlertCircle className="size-3.5" />
  }
}

function ledgerLabel(type: string) {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// ─── Tab type ───────────────────────────────────────────────────────

type Tab = 'server' | 'overview' | 'workspaces' | 'credit-logs' | 'ledger' | 'runs' | 'schedule-runs'

// ─── Main ───────────────────────────────────────────────────────────

export function MonitoringClient({
  stats, workspaces, creditLogs, ledgerEntries,
  runs, scheduleRuns, modelUsage, creditsByType,
}: {
  stats: PlatformStats
  workspaces: WorkspaceResource[]
  creditLogs: CreditLog[]
  ledgerEntries: LedgerEntry[]
  runs: RunEntry[]
  scheduleRuns: ScheduleRunEntry[]
  modelUsage: ModelUsage[]
  creditsByType: CreditsByType[]
}) {
  const [tab, setTab] = React.useState<Tab>('server')

  const tabs: { key: Tab; label: string }[] = [
    { key: 'server', label: 'Server' },
    { key: 'overview', label: 'Overview' },
    { key: 'workspaces', label: 'Workspaces' },
    { key: 'credit-logs', label: 'API Calls' },
    { key: 'ledger', label: 'Credit Ledger' },
    { key: 'runs', label: 'Runs' },
    { key: 'schedule-runs', label: 'Scheduled Runs' },
  ]

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* ── Header ── */}
      <div className="shrink-0 border-b bg-card">
        <div className="flex items-center justify-between px-6 py-5">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Resource Monitoring</h1>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              Platform-wide usage and resource tracking
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-0 px-6 -mb-px">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors',
                tab === t.key
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-auto p-6">
        {tab === 'server' && <ServerTab />}
        {tab === 'overview' && (
          <OverviewTab stats={stats} modelUsage={modelUsage} creditsByType={creditsByType} />
        )}
        {tab === 'workspaces' && <WorkspacesTab workspaces={workspaces} />}
        {tab === 'credit-logs' && <CreditLogsTab logs={creditLogs} />}
        {tab === 'ledger' && <LedgerTab entries={ledgerEntries} />}
        {tab === 'runs' && <RunsTab runs={runs} />}
        {tab === 'schedule-runs' && <ScheduleRunsTab runs={scheduleRuns} />}
      </div>
    </div>
  )
}

// ─── Overview Tab ───────────────────────────────────────────────────

function OverviewTab({
  stats, modelUsage, creditsByType,
}: {
  stats: PlatformStats; modelUsage: ModelUsage[]; creditsByType: CreditsByType[]
}) {
  const statCards = [
    { label: 'Total Users', value: stats.total_users, icon: Users, accent: 'text-blue-600 bg-blue-50' },
    { label: 'Workspaces', value: stats.total_workspaces, icon: Building2, accent: 'text-violet-600 bg-violet-50' },
    { label: 'Agents', value: stats.total_agents, icon: Bot, accent: 'text-emerald-600 bg-emerald-50' },
    { label: 'Sessions', value: stats.total_sessions, icon: MessageSquare, accent: 'text-amber-600 bg-amber-50' },
    { label: 'Messages', value: stats.total_messages, icon: MessageSquare, accent: 'text-cyan-600 bg-cyan-50' },
    { label: 'Total Runs', value: stats.total_runs, icon: Play, accent: 'text-indigo-600 bg-indigo-50' },
    { label: 'Credits Used', value: stats.total_credits_consumed, icon: Coins, accent: 'text-orange-600 bg-orange-50' },
    { label: 'Credits Balance', value: stats.total_credits_balance, icon: Zap, accent: 'text-emerald-600 bg-emerald-50' },
    { label: 'KB Documents', value: stats.total_kb_documents, icon: FileText, accent: 'text-pink-600 bg-pink-50' },
    { label: 'Schedules', value: stats.total_schedules, icon: Calendar, accent: 'text-teal-600 bg-teal-50' },
    { label: 'Active Schedules', value: stats.active_schedules, icon: Clock, accent: 'text-green-600 bg-green-50' },
    { label: 'Integrations', value: stats.total_integrations, icon: Plug, accent: 'text-purple-600 bg-purple-50' },
  ]

  return (
    <div className="space-y-6">
      {/* Stat cards grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        {statCards.map((s) => (
          <div key={s.label} className="rounded-xl border bg-card p-4">
            <div className="flex items-center justify-between mb-3">
              <span className={cn('flex size-8 items-center justify-center rounded-lg', s.accent)}>
                <s.icon className="size-4" />
              </span>
            </div>
            <p className="text-2xl font-bold tracking-tight">{fmtNum(s.value)}</p>
            <p className="text-[12px] text-muted-foreground mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Model Usage */}
        <div className="rounded-xl border bg-card">
          <div className="px-5 py-4 border-b">
            <h3 className="text-[14px] font-semibold">Model Usage</h3>
            <p className="text-[12px] text-muted-foreground mt-0.5">API calls by model</p>
          </div>
          {modelUsage.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-[13px] text-muted-foreground">No data yet</div>
          ) : (
            <div className="divide-y">
              {modelUsage.map((m) => (
                <div key={m.model} className="flex items-center justify-between px-5 py-3">
                  <div className="flex items-center gap-3">
                    <span className="flex size-8 items-center justify-center rounded-lg bg-muted">
                      <Bot className="size-4 text-muted-foreground" />
                    </span>
                    <div>
                      <p className="text-[13px] font-medium font-mono">{m.model}</p>
                      <p className="text-[11px] text-muted-foreground">{fmtNum(m.call_count)} calls</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[13px] font-semibold">{fmtNum(m.total_credits)} credits</p>
                    <p className="text-[11px] text-muted-foreground">{fmtNum(m.total_tokens)} tokens</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Credits by Type */}
        <div className="rounded-xl border bg-card">
          <div className="px-5 py-4 border-b">
            <h3 className="text-[14px] font-semibold">Credits by Activity</h3>
            <p className="text-[12px] text-muted-foreground mt-0.5">Breakdown by transaction type</p>
          </div>
          {creditsByType.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-[13px] text-muted-foreground">No data yet</div>
          ) : (
            <div className="divide-y">
              {creditsByType.map((c) => {
                const isPositive = ['subscription_grant', 'topup', 'refund', 'manual_adjustment'].includes(c.type)
                return (
                  <div key={c.type} className="flex items-center justify-between px-5 py-3">
                    <div className="flex items-center gap-3">
                      <span className={cn('flex size-8 items-center justify-center rounded-lg', isPositive ? 'bg-emerald-50 text-emerald-600' : 'bg-orange-50 text-orange-600')}>
                        {isPositive ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
                      </span>
                      <div>
                        <p className="text-[13px] font-medium">{ledgerLabel(c.type)}</p>
                        <p className="text-[11px] text-muted-foreground">{fmtNum(c.entry_count)} entries</p>
                      </div>
                    </div>
                    <p className={cn('text-[13px] font-semibold', isPositive ? 'text-emerald-600' : 'text-foreground')}>
                      {isPositive ? '+' : ''}{fmtNum(c.total_amount)}
                    </p>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Workspaces Tab ─────────────────────────────────────────────────

function WorkspacesTab({ workspaces }: { workspaces: WorkspaceResource[] }) {
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set())

  function toggle(id: string) {
    setExpanded((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  return (
    <div className="space-y-3">
      {workspaces.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Building2 className="size-8 opacity-20 mb-2" />
          <p className="text-[13px]">No workspaces found</p>
        </div>
      ) : workspaces.map((w) => {
        const usage = pct(w.total_credits_consumed, w.plan_credits + w.topup_credits)
        const isExpanded = expanded.has(w.workspace_id)

        return (
          <div key={w.workspace_id} className="rounded-xl border bg-card overflow-hidden">
            {/* Header row */}
            <button
              onClick={() => toggle(w.workspace_id)}
              className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-muted/30 transition-colors"
            >
              <span className="flex size-10 items-center justify-center rounded-lg bg-foreground text-background text-[13px] font-bold shrink-0">
                {w.workspace_name.charAt(0).toUpperCase()}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-[14px] font-semibold truncate">{w.workspace_name}</p>
                  {w.overage_enabled && (
                    <Badge variant="muted" className="text-[10px]">Overage</Badge>
                  )}
                </div>
                <p className="text-[12px] text-muted-foreground truncate">
                  {w.owner_name} &middot; {w.owner_email}
                </p>
              </div>

              {/* Quick stats */}
              <div className="hidden md:flex items-center gap-6 shrink-0">
                <QuickStat label="Agents" value={w.agent_count} />
                <QuickStat label="Sessions" value={w.session_count} />
                <QuickStat label="Messages" value={w.message_count} />
                <div className="w-32">
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-muted-foreground">Credits</span>
                    <span className="font-medium">{usage}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn('h-full rounded-full transition-all', usage > 80 ? 'bg-red-500' : usage > 50 ? 'bg-amber-500' : 'bg-emerald-500')}
                      style={{ width: `${usage}%` }}
                    />
                  </div>
                </div>
              </div>

              {isExpanded ? <ChevronUp className="size-4 text-muted-foreground shrink-0" /> : <ChevronDown className="size-4 text-muted-foreground shrink-0" />}
            </button>

            {/* Expanded details */}
            {isExpanded && (
              <div className="border-t px-5 py-4 bg-muted/20">
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                  <DetailStat label="Credits Balance" value={fmtNum(w.credits_balance)} icon={Coins} />
                  <DetailStat label="Plan Credits" value={fmtNum(w.plan_credits)} icon={Zap} />
                  <DetailStat label="Topup Credits" value={fmtNum(w.topup_credits)} icon={ArrowUpRight} />
                  <DetailStat label="Total Consumed" value={fmtNum(w.total_credits_consumed)} icon={ArrowDownRight} />
                  <DetailStat label="Agents" value={fmtNum(w.agent_count)} icon={Bot} />
                  <DetailStat label="Sessions" value={fmtNum(w.session_count)} icon={MessageSquare} />
                  <DetailStat label="Messages" value={fmtNum(w.message_count)} icon={MessageSquare} />
                  <DetailStat label="Members" value={fmtNum(w.member_count)} icon={Users} />
                  <DetailStat label="Knowledge Bases" value={fmtNum(w.kb_count)} icon={Database} />
                  <DetailStat label="KB Documents" value={fmtNum(w.kb_doc_count)} icon={FileText} />
                  <DetailStat label="Schedules" value={fmtNum(w.schedule_count)} icon={Calendar} />
                  <DetailStat label="Tools" value={fmtNum(w.tool_count)} icon={Wrench} />
                  <DetailStat label="Integrations" value={fmtNum(w.integration_count)} icon={Plug} />
                  {w.overage_enabled && (
                    <DetailStat label="Overage Limit" value={fmtNum(w.overage_limit)} icon={AlertCircle} />
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function QuickStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <p className="text-[14px] font-semibold">{fmtNum(value)}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  )
}

function DetailStat({ label, value, icon: Icon }: { label: string; value: string; icon: React.ElementType }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex size-8 items-center justify-center rounded-lg bg-muted shrink-0">
        <Icon className="size-3.5 text-muted-foreground" />
      </span>
      <div>
        <p className="text-[13px] font-semibold">{value}</p>
        <p className="text-[11px] text-muted-foreground">{label}</p>
      </div>
    </div>
  )
}

// ─── Credit Logs Tab ────────────────────────────────────────────────

function CreditLogsTab({ logs }: { logs: CreditLog[] }) {
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Workspace</th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Agent</th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Model</th>
            <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Tokens</th>
            <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Credits</th>
            <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Time</th>
          </tr>
        </thead>
        <tbody>
          {logs.length === 0 ? (
            <tr><td colSpan={6} className="py-16 text-center text-muted-foreground">No API call logs yet</td></tr>
          ) : logs.map((log) => (
            <tr key={log.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
              <td className="px-4 py-2.5 font-medium">{log.workspace_name ?? '—'}</td>
              <td className="px-4 py-2.5 text-muted-foreground">{log.agent_name ?? '—'}</td>
              <td className="px-4 py-2.5">
                <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-mono">{log.model}</code>
              </td>
              <td className="px-4 py-2.5 text-right font-mono tabular-nums">{fmtNum(log.tokens_used)}</td>
              <td className="px-4 py-2.5 text-right font-mono tabular-nums font-semibold">{fmtNum(log.credits_deducted)}</td>
              <td className="px-4 py-2.5 text-right text-muted-foreground whitespace-nowrap">{fmtDate(log.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Ledger Tab ─────────────────────────────────────────────────────

function LedgerTab({ entries }: { entries: LedgerEntry[] }) {
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Workspace</th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Type</th>
            <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Amount</th>
            <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Balance After</th>
            <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Time</th>
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 ? (
            <tr><td colSpan={5} className="py-16 text-center text-muted-foreground">No ledger entries yet</td></tr>
          ) : entries.map((e) => {
            const isPositive = e.amount > 0
            return (
              <tr key={e.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-2.5 font-medium">{e.workspace_name ?? '—'}</td>
                <td className="px-4 py-2.5">
                  <Badge variant="muted" className="text-[11px] font-medium">{ledgerLabel(e.type)}</Badge>
                </td>
                <td className={cn('px-4 py-2.5 text-right font-mono tabular-nums font-semibold', isPositive ? 'text-emerald-600' : 'text-red-600')}>
                  {isPositive ? '+' : ''}{fmtNum(e.amount)}
                </td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums">{fmtNum(e.credits_after)}</td>
                <td className="px-4 py-2.5 text-right text-muted-foreground whitespace-nowrap">{fmtDate(e.created_at)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Runs Tab ───────────────────────────────────────────────────────

function RunsTab({ runs }: { runs: RunEntry[] }) {
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Workspace</th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Session</th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Error</th>
            <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Time</th>
          </tr>
        </thead>
        <tbody>
          {runs.length === 0 ? (
            <tr><td colSpan={5} className="py-16 text-center text-muted-foreground">No runs yet</td></tr>
          ) : runs.map((r) => (
            <tr key={r.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
              <td className="px-4 py-2.5 font-medium">{r.workspace_name ?? '—'}</td>
              <td className="px-4 py-2.5 text-muted-foreground max-w-[200px] truncate">{r.session_title ?? '—'}</td>
              <td className="px-4 py-2.5">
                <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium', statusColor(r.status))}>
                  {statusIcon(r.status)}
                  {r.status}
                </span>
              </td>
              <td className="px-4 py-2.5 text-red-600 text-[12px] max-w-[250px] truncate">{r.error ?? '—'}</td>
              <td className="px-4 py-2.5 text-right text-muted-foreground whitespace-nowrap">{fmtDate(r.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Schedule Runs Tab ──────────────────────────────────────────────

function ScheduleRunsTab({ runs }: { runs: ScheduleRunEntry[] }) {
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Schedule</th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Workspace</th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
            <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Credits</th>
            <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Duration</th>
            <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Started</th>
          </tr>
        </thead>
        <tbody>
          {runs.length === 0 ? (
            <tr><td colSpan={6} className="py-16 text-center text-muted-foreground">No scheduled runs yet</td></tr>
          ) : runs.map((r) => (
            <tr key={r.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
              <td className="px-4 py-2.5 font-medium">{r.schedule_name ?? '—'}</td>
              <td className="px-4 py-2.5 text-muted-foreground">{r.workspace_name ?? '—'}</td>
              <td className="px-4 py-2.5">
                <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium', statusColor(r.status))}>
                  {statusIcon(r.status)}
                  {r.status}
                </span>
              </td>
              <td className="px-4 py-2.5 text-right font-mono tabular-nums">{fmtNum(r.credits_used)}</td>
              <td className="px-4 py-2.5 text-right text-muted-foreground">{fmtDuration(r.duration_ms)}</td>
              <td className="px-4 py-2.5 text-right text-muted-foreground whitespace-nowrap">{fmtDate(r.started_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Server Tab ─────────────────────────────────────────────────────

interface ContainerStat {
  id: string
  name: string
  cpu: string
  memUsage: string
  memLimit: string
  memPercent: string
  netIO: string
  blockIO: string
  pids: string
  status: string
  ports: string
}

interface ServerInfo {
  hostname: string
  platform: string
  arch: string
  cpus: number
  cpuModel: string
  totalMemory: string
  freeMemory: string
  usedMemory: string
  memoryPercent: number
  uptime: string
  loadAvg: number[]
}

function getContainerLabel(name: string) {
  return name.replace(/^pushable_3_0-/, '').replace(/-\d+$/, '')
}

function parsePercent(s: string) {
  return parseFloat(s.replace('%', '')) || 0
}

function ServerTab() {
  const router = useRouter()
  const [data, setData] = React.useState<{ containers: ContainerStat[]; server: ServerInfo } | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = React.useState<Date | null>(null)

  const fetchStats = React.useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/server-stats')
      if (!res.ok) throw new Error('Failed to fetch')
      const json = await res.json()
      setData(json)
      setLastUpdated(new Date())
      setError(null)
    } catch {
      setError('Failed to load server stats')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { fetchStats() }, [fetchStats])

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Server className="size-8 opacity-20 mb-2" />
        <p className="text-[13px]">{error}</p>
        <button onClick={fetchStats} className="mt-3 text-[13px] font-medium text-foreground hover:underline">Retry</button>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="size-6 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-muted-foreground" />
      </div>
    )
  }

  const { containers, server } = data

  return (
    <div className="space-y-6">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h3 className="text-[14px] font-semibold">{containers.length} Containers Running</h3>
          {lastUpdated && (
            <span className="text-[12px] text-muted-foreground">
              {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </div>
        <button
          onClick={fetchStats}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Host summary */}
      <div className="rounded-xl border bg-card p-5">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
          <div>
            <p className="text-[11px] text-muted-foreground mb-1">CPU</p>
            <p className="text-[18px] font-bold">{server.cpus} cores</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground mb-1">Memory Used</p>
            <p className="text-[18px] font-bold">{server.usedMemory} <span className="text-[13px] font-normal text-muted-foreground">/ {server.totalMemory}</span></p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground mb-1">Memory Free</p>
            <p className="text-[18px] font-bold text-emerald-600">{server.freeMemory}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground mb-1">Memory Usage</p>
            <div className="flex items-center gap-3">
              <p className="text-[18px] font-bold">{server.memoryPercent}%</p>
              <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn('h-full rounded-full',
                    server.memoryPercent > 85 ? 'bg-red-500' : server.memoryPercent > 60 ? 'bg-amber-500' : 'bg-emerald-500')}
                  style={{ width: `${server.memoryPercent}%` }}
                />
              </div>
            </div>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground mb-1">Uptime</p>
            <p className="text-[18px] font-bold">{server.uptime}</p>
          </div>
        </div>
      </div>

      {/* Container table */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Container</th>
              <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
              <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">CPU</th>
              <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Memory</th>
              <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Net I/O</th>
              <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Port</th>
            </tr>
          </thead>
          <tbody>
            {containers.map((c) => {
              const label = getContainerLabel(c.name)
              const cpuVal = parsePercent(c.cpu)
              const memVal = parsePercent(c.memPercent)
              const isHealthy = c.status.includes('healthy') || c.status.startsWith('Up')
              // Extract just the main port
              const mainPort = c.ports.match(/(\d+)→(\d+)/)?.[0] || ''

              return (
                <tr
                  key={c.name}
                  onClick={() => router.push(`/monitoring/logs?id=${c.id}&name=${encodeURIComponent(c.name)}`)}
                  className="border-b border-border/50 hover:bg-muted/20 transition-colors cursor-pointer"
                >
                  {/* Name */}
                  <td className="px-5 py-3">
                    <p className="font-semibold">{label}</p>
                  </td>

                  {/* Status */}
                  <td className="px-5 py-3">
                    <span className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium',
                      isHealthy ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700',
                    )}>
                      <span className={cn('size-1.5 rounded-full', isHealthy ? 'bg-emerald-500' : 'bg-red-500')} />
                      {isHealthy ? 'Running' : 'Down'}
                    </span>
                  </td>

                  {/* CPU */}
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5 w-32">
                      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className={cn('h-full rounded-full',
                            cpuVal > 50 ? 'bg-red-500' : cpuVal > 20 ? 'bg-amber-500' : 'bg-blue-500')}
                          style={{ width: `${Math.max(cpuVal * 5, 2)}%` }}
                        />
                      </div>
                      <span className="text-[12px] font-mono tabular-nums w-12 text-right">{c.cpu}</span>
                    </div>
                  </td>

                  {/* Memory */}
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5 w-44">
                      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className={cn('h-full rounded-full',
                            memVal > 70 ? 'bg-red-500' : memVal > 40 ? 'bg-amber-500' : 'bg-violet-500')}
                          style={{ width: `${memVal}%` }}
                        />
                      </div>
                      <span className="text-[12px] font-mono tabular-nums shrink-0">{c.memUsage}</span>
                    </div>
                  </td>

                  {/* Net I/O */}
                  <td className="px-5 py-3 text-right text-[12px] text-muted-foreground font-mono tabular-nums">
                    {c.netIO}
                  </td>

                  {/* Port */}
                  <td className="px-5 py-3 text-right">
                    {mainPort ? (
                      <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-mono">{mainPort}</code>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
