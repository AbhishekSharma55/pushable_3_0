'use client'

import * as React from 'react'
import {
  Search, Plus, MoreHorizontal, Pencil, Trash2,
  Wrench, Globe, Building2, ShieldCheck, X,
  Calendar, Copy, Check, Settings2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenuRoot, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuDestructiveItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
  SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'
import type { AdminTool, WorkspaceOption } from '@/app/actions/tools'
import { createTool, updateTool, deleteTool } from '@/app/actions/tools'

// ─── Helpers ────────────────────────────────────────────────────────

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function timeAgo(d: string | null) {
  if (!d) return ''
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return fmtDate(d)
}

const TOOL_COLORS: Record<string, string> = {
  mcp: 'from-blue-500 to-cyan-500',
  function: 'from-violet-500 to-purple-500',
}

// ─── Main ───────────────────────────────────────────────────────────

export function ToolsClient({
  initialTools, workspaces,
}: {
  initialTools: AdminTool[]
  workspaces: WorkspaceOption[]
}) {
  const [tools, setTools] = React.useState<AdminTool[]>(initialTools)
  const [search, setSearch] = React.useState('')
  const [typeFilter, setTypeFilter] = React.useState<'All' | 'mcp' | 'function'>('All')
  const [scopeFilter, setScopeFilter] = React.useState<'All' | 'Global' | 'Workspace'>('All')
  const [showForm, setShowForm] = React.useState(false)
  const [editingTool, setEditingTool] = React.useState<AdminTool | null>(null)
  const [view, setView] = React.useState<'grid' | 'table'>('grid')

  const filtered = React.useMemo(() =>
    tools.filter((t) => {
      const q = search.toLowerCase()
      const matchSearch = !q || t.name.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q)
      const matchType = typeFilter === 'All' || t.type === typeFilter
      const matchScope = scopeFilter === 'All' || (scopeFilter === 'Global' ? t.is_global : !t.is_global)
      return matchSearch && matchType && matchScope
    }), [tools, search, typeFilter, scopeFilter])

  const globalCount = tools.filter((t) => t.is_global).length
  const workspaceCount = tools.filter((t) => !t.is_global).length
  const mcpCount = tools.filter((t) => t.type === 'mcp').length
  const fnCount = tools.filter((t) => t.type === 'function').length

  async function handleDelete(id: string) {
    if (!confirm('Delete this tool? This cannot be undone.')) return
    await deleteTool(id)
    setTools((p) => p.filter((t) => t.id !== id))
  }

  function openEdit(tool: AdminTool) {
    setEditingTool(tool)
    setShowForm(true)
  }

  function openCreate() {
    setEditingTool(null)
    setShowForm(true)
  }

  function handleSaved(tool: AdminTool, isNew: boolean) {
    if (isNew) {
      setTools((p) => [tool, ...p])
    } else {
      setTools((p) => p.map((t) => t.id === tool.id ? tool : t))
    }
    setShowForm(false)
    setEditingTool(null)
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* ── Header ── */}
      <div className="shrink-0 border-b bg-card">
        <div className="flex items-center justify-between px-6 py-5">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Tools</h1>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              Manage MCP and function tools across your platform
            </p>
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus className="size-4" /> Create Tool
          </Button>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-3 px-6 pb-4">
          <StatPill icon={Wrench} label="Total" value={tools.length} className="bg-muted/60 text-muted-foreground" />
          <StatPill icon={Globe} label="Global" value={globalCount} className="bg-blue-50 text-blue-700" />
          <StatPill icon={Building2} label="Workspace" value={workspaceCount} className="bg-violet-50 text-violet-700" />
          <div className="h-4 w-px bg-border mx-1" />
          <StatPill icon={Settings2} label="MCP" value={mcpCount} className="bg-cyan-50 text-cyan-700" />
          <StatPill icon={Wrench} label="Function" value={fnCount} className="bg-purple-50 text-purple-700" />

          <div className="ml-auto flex items-center gap-2">
            {/* View toggle */}
            <div className="flex rounded-lg border bg-muted/30 p-0.5">
              <button
                onClick={() => setView('grid')}
                className={cn('rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors',
                  view === 'grid' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}
              >Grid</button>
              <button
                onClick={() => setView('table')}
                className={cn('rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors',
                  view === 'table' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}
              >Table</button>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2.5 px-6 pb-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
            <Input
              placeholder="Search tools…"
              className="h-8 pl-9 text-[13px] bg-muted/40 border-transparent focus-visible:border-border focus-visible:bg-background"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <SelectRoot value={typeFilter} onValueChange={(v) => setTypeFilter(v as typeof typeFilter)}>
            <SelectTrigger className="w-28 h-8 text-[12px] bg-muted/40 border-transparent">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All Types</SelectItem>
              <SelectItem value="mcp">MCP</SelectItem>
              <SelectItem value="function">Function</SelectItem>
            </SelectContent>
          </SelectRoot>
          <SelectRoot value={scopeFilter} onValueChange={(v) => setScopeFilter(v as typeof scopeFilter)}>
            <SelectTrigger className="w-28 h-8 text-[12px] bg-muted/40 border-transparent">
              <SelectValue placeholder="Scope" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All Scopes</SelectItem>
              <SelectItem value="Global">Global</SelectItem>
              <SelectItem value="Workspace">Workspace</SelectItem>
            </SelectContent>
          </SelectRoot>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-auto p-6">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-muted/50 mb-4">
              <Wrench className="size-7 opacity-30" />
            </div>
            <p className="text-[14px] font-medium mb-1">No tools found</p>
            <p className="text-[13px] text-muted-foreground/70 mb-4">Create your first tool to get started</p>
            <Button size="sm" onClick={openCreate}>
              <Plus className="size-3.5" /> Create Tool
            </Button>
          </div>
        ) : view === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((tool) => (
              <ToolCard key={tool.id} tool={tool} onEdit={openEdit} onDelete={handleDelete} />
            ))}
          </div>
        ) : (
          <ToolTable tools={filtered} onEdit={openEdit} onDelete={handleDelete} />
        )}
      </div>

      {/* ── Create/Edit Modal ── */}
      {showForm && (
        <ToolFormModal
          tool={editingTool}
          workspaces={workspaces}
          onClose={() => { setShowForm(false); setEditingTool(null) }}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}

// ─── Stat Pill ──────────────────────────────────────────────────────

function StatPill({ icon: Icon, label, value, className }: {
  icon: React.ElementType; label: string; value: number; className: string
}) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium', className)}>
      <Icon className="size-3.5" />
      {value} {label}
    </span>
  )
}

// ─── Tool Card ──────────────────────────────────────────────────────

function ToolCard({ tool, onEdit, onDelete }: {
  tool: AdminTool
  onEdit: (t: AdminTool) => void
  onDelete: (id: string) => void
}) {
  const [copied, setCopied] = React.useState(false)
  const gradient = TOOL_COLORS[tool.type] || TOOL_COLORS.mcp

  function copyId() {
    navigator.clipboard.writeText(tool.id)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="group rounded-xl border bg-card transition-all hover:shadow-md hover:border-border/80">
      {/* Top accent */}
      <div className={cn('h-1 rounded-t-xl bg-linear-to-r', gradient)} />

      <div className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className={cn('flex size-10 items-center justify-center rounded-xl bg-linear-to-br text-white shadow-sm', gradient)}>
              <Wrench className="size-4.5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-[14px] font-semibold truncate">{tool.name}</h3>
              <div className="flex items-center gap-1.5 mt-0.5">
                <Badge variant={tool.type === 'mcp' ? 'blue' : 'purple'} className="text-[10px] font-semibold uppercase px-1.5 py-0">
                  {tool.type}
                </Badge>
                {tool.is_global && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-blue-600">
                    <Globe className="size-2.5" /> Global
                  </span>
                )}
              </div>
            </div>
          </div>

          <DropdownMenuRoot>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="size-7 opacity-0 group-hover:opacity-100 shrink-0">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(tool)}>
                <Pencil className="size-3.5" /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={copyId}>
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied ? 'Copied!' : 'Copy ID'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuDestructiveItem onClick={() => onDelete(tool.id)}>
                <Trash2 className="size-3.5" /> Delete
              </DropdownMenuDestructiveItem>
            </DropdownMenuContent>
          </DropdownMenuRoot>
        </div>

        {/* Description */}
        <p className="text-[12px] text-muted-foreground line-clamp-2 min-h-[32px] mb-4">
          {tool.description || 'No description'}
        </p>

        {/* Meta */}
        <div className="space-y-2">
          {/* Workspace */}
          <div className="flex items-center justify-between text-[12px]">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Building2 className="size-3" /> Workspace
            </span>
            <span className="font-medium truncate max-w-[140px]">
              {tool.workspace_name ?? <span className="text-muted-foreground/50">All</span>}
            </span>
          </div>

          {/* Approval */}
          <div className="flex items-center justify-between text-[12px]">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <ShieldCheck className="size-3" /> Approval
            </span>
            {tool.requires_approval ? (
              <span className="font-medium text-amber-600">Required</span>
            ) : (
              <span className="text-muted-foreground/50">Not required</span>
            )}
          </div>

          {/* Created */}
          <div className="flex items-center justify-between text-[12px]">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Calendar className="size-3" /> Created
            </span>
            <span className="text-muted-foreground">{timeAgo(tool.created_at)}</span>
          </div>
        </div>

        {/* Config preview */}
        {tool.config && Object.keys(tool.config).length > 0 && (
          <div className="mt-3 pt-3 border-t">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1.5">Config</p>
            <pre className="text-[11px] font-mono text-muted-foreground bg-muted/30 rounded-lg px-3 py-2 overflow-auto max-h-20 leading-relaxed">
              {JSON.stringify(tool.config, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Tool Table ─────────────────────────────────────────────────────

function ToolTable({ tools, onEdit, onDelete }: {
  tools: AdminTool[]
  onEdit: (t: AdminTool) => void
  onDelete: (id: string) => void
}) {
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">Name</th>
            <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">Type</th>
            <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">Scope</th>
            <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">Workspace</th>
            <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">Approval</th>
            <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">Created</th>
            <th className="w-11 pr-4 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {tools.map((tool) => (
            <tr key={tool.id} className="group border-b border-border/50 transition-colors hover:bg-muted/20">
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className={cn('flex size-8 items-center justify-center rounded-lg bg-linear-to-br text-white shrink-0', TOOL_COLORS[tool.type])}>
                    <Wrench className="size-3.5" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium truncate">{tool.name}</p>
                    {tool.description && (
                      <p className="text-[12px] text-muted-foreground mt-0.5 line-clamp-1 max-w-xs">{tool.description}</p>
                    )}
                  </div>
                </div>
              </td>
              <td className="px-4 py-3">
                <Badge variant={tool.type === 'mcp' ? 'blue' : 'purple'} className="text-[11px] font-semibold uppercase">
                  {tool.type}
                </Badge>
              </td>
              <td className="px-4 py-3">
                {tool.is_global ? (
                  <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-blue-700">
                    <Globe className="size-3" /> Global
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
                    <Building2 className="size-3" /> Workspace
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {tool.workspace_name ?? <span className="text-muted-foreground/40">—</span>}
              </td>
              <td className="px-4 py-3">
                {tool.requires_approval ? (
                  <span className="inline-flex items-center gap-1 text-[12px] font-medium text-amber-600">
                    <ShieldCheck className="size-3.5" /> Required
                  </span>
                ) : (
                  <span className="text-[12px] text-muted-foreground/50">No</span>
                )}
              </td>
              <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDate(tool.created_at)}</td>
              <td className="pr-4 py-3">
                <DropdownMenuRoot>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon" variant="ghost" className="size-7 opacity-0 group-hover:opacity-100">
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onEdit(tool)}>
                      <Pencil className="size-3.5" /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuDestructiveItem onClick={() => onDelete(tool.id)}>
                      <Trash2 className="size-3.5" /> Delete
                    </DropdownMenuDestructiveItem>
                  </DropdownMenuContent>
                </DropdownMenuRoot>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Form Modal ─────────────────────────────────────────────────────

function ToolFormModal({
  tool, workspaces, onClose, onSaved,
}: {
  tool: AdminTool | null
  workspaces: WorkspaceOption[]
  onClose: () => void
  onSaved: (tool: AdminTool, isNew: boolean) => void
}) {
  const isEdit = !!tool
  const [name, setName] = React.useState(tool?.name ?? '')
  const [description, setDescription] = React.useState(tool?.description ?? '')
  const [type, setType] = React.useState<'mcp' | 'function'>(tool?.type ?? 'mcp')
  const [config, setConfig] = React.useState(tool ? JSON.stringify(tool.config, null, 2) : '{}')
  const [isGlobal, setIsGlobal] = React.useState(tool?.is_global ?? true)
  const [requiresApproval, setRequiresApproval] = React.useState(tool?.requires_approval ?? false)
  const [workspaceId, setWorkspaceId] = React.useState(tool?.workspace_id ?? '')
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required'); return }

    setSaving(true)
    setError(null)

    try {
      const data = {
        name: name.trim(),
        description: description.trim(),
        type,
        config,
        is_global: isGlobal,
        requires_approval: requiresApproval,
        workspace_id: isGlobal ? null : (workspaceId || null),
      }

      if (isEdit && tool) {
        await updateTool(tool.id, data)
        onSaved({
          ...tool,
          ...data,
          config: JSON.parse(config || '{}'),
          updated_at: new Date().toISOString(),
          workspace_name: workspaces.find((w) => w.id === data.workspace_id)?.name ?? null,
        }, false)
      } else {
        await createTool(data)
        window.location.reload()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border bg-card shadow-2xl animate-in fade-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-3">
            <div className={cn('flex size-9 items-center justify-center rounded-xl bg-linear-to-br text-white', isEdit ? TOOL_COLORS[tool?.type ?? 'mcp'] : 'from-zinc-600 to-zinc-800')}>
              <Wrench className="size-4" />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold">{isEdit ? 'Edit Tool' : 'Create New Tool'}</h2>
              <p className="text-[12px] text-muted-foreground">
                {isEdit ? 'Update tool configuration' : 'Add a new MCP or function tool'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
            <X className="size-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-[13px] text-destructive">
              {error}
            </div>
          )}

          {/* Name + Type row */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <label className="text-[13px] font-medium">Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Web Search, Gmail Reader"
                className="h-10 text-[13px]"
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium">Type</label>
              <SelectRoot value={type} onValueChange={(v) => setType(v as typeof type)}>
                <SelectTrigger className="h-10 text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mcp">MCP</SelectItem>
                  <SelectItem value="function">Function</SelectItem>
                </SelectContent>
              </SelectRoot>
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium">Description</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this tool do?"
              className="h-10 text-[13px]"
            />
          </div>

          {/* Config JSON */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[13px] font-medium">Config (JSON)</label>
              <span className="text-[11px] text-muted-foreground">Connection settings, endpoints, etc.</span>
            </div>
            <textarea
              value={config}
              onChange={(e) => setConfig(e.target.value)}
              placeholder="{}"
              rows={5}
              className="w-full rounded-xl border bg-muted/20 px-3.5 py-2.5 text-[13px] font-mono resize-y focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring leading-relaxed"
            />
          </div>

          {/* Options */}
          <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Options</p>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Globe className="size-4 text-muted-foreground" />
                <div>
                  <p className="text-[13px] font-medium">Global tool</p>
                  <p className="text-[11px] text-muted-foreground">Available to all workspaces</p>
                </div>
              </div>
              <Checkbox
                id="is-global"
                checked={isGlobal}
                onCheckedChange={(v) => setIsGlobal(v === true)}
              />
            </div>
            <div className="h-px bg-border" />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="size-4 text-muted-foreground" />
                <div>
                  <p className="text-[13px] font-medium">Requires approval</p>
                  <p className="text-[11px] text-muted-foreground">Admin must approve each use</p>
                </div>
              </div>
              <Checkbox
                id="requires-approval"
                checked={requiresApproval}
                onCheckedChange={(v) => setRequiresApproval(v === true)}
              />
            </div>
          </div>

          {/* Workspace (if not global) */}
          {!isGlobal && (
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium">Assign to workspace</label>
              <SelectRoot value={workspaceId} onValueChange={setWorkspaceId}>
                <SelectTrigger className="h-10 text-[13px]">
                  <SelectValue placeholder="Select a workspace" />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((w) => (
                    <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </SelectRoot>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving ? (
                <span className="size-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
              ) : isEdit ? 'Save Changes' : 'Create Tool'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
