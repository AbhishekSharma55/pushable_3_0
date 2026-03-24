'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  Globe, Database, Bot, Monitor, Key, CheckCircle2, XCircle,
  Wrench, Shield, Plug, Server, Network, Lock, Unlock, Zap,
  Plus, Trash2, X, Save, Edit2, Eye, ChevronDown, Check, Search,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import {
  createLLMModel, updateLLMModel, deleteLLMModel, toggleLLMModel,
  createBrowserProxy, deleteBrowserProxy, toggleBrowserProxy,
  updateSystemSetting,
} from '@/app/actions/configuration'
import type {
  LLMModel, ServiceStatus, EnvConfig,
  BrowserProxy, BrowserProfile, BrowserSession,
  AgentDefaults, IntegrationSummary, SystemSettings,
} from '@/app/actions/configuration'

// ─── Helpers ────────────────────────────────────────────────────────

function StatusDot({ status }: { status: 'online' | 'offline' | 'unknown' }) {
  return (
    <span className={cn(
      'inline-block size-2 rounded-full',
      status === 'online' ? 'bg-emerald-500' : status === 'offline' ? 'bg-red-500' : 'bg-zinc-400',
    )} />
  )
}

function KeyStatus({ configured, label }: { configured: boolean; label: string }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border/50 last:border-0">
      <div className="flex items-center gap-2.5">
        <Key className="size-3.5 text-muted-foreground" />
        <span className="text-[13px] font-medium">{label}</span>
      </div>
      <span className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium',
        configured ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700',
      )}>
        {configured ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
        {configured ? 'Configured' : 'Missing'}
      </span>
    </div>
  )
}

function ConfigRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between px-5 py-3.5">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className={cn('text-[13px] font-medium', mono && 'font-mono text-[12px]')}>{value}</span>
    </div>
  )
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// Reusable input
function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12px] font-medium text-muted-foreground mb-1">{label}</label>
      {children}
    </div>
  )
}

const inputCls = 'w-full rounded-lg border bg-background px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-foreground/20'
const selectCls = 'w-full rounded-lg border bg-background px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-foreground/20'

// ─── Model Picker ───────────────────────────────────────────────────

function ModelPicker({ value, onChange, models }: {
  value: string; onChange: (v: string) => void; models: LLMModel[]
}) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const activeModels = models.filter((m) => m.is_active)
  const filtered = activeModels.filter((m) =>
    m.display_name.toLowerCase().includes(search.toLowerCase()) ||
    m.model_id.toLowerCase().includes(search.toLowerCase()) ||
    m.provider.toLowerCase().includes(search.toLowerCase())
  )

  const selected = models.find((m) => m.model_id === value)

  // Group by provider
  const grouped = filtered.reduce<Record<string, LLMModel[]>>((acc, m) => {
    (acc[m.provider] = acc[m.provider] || []).push(m)
    return acc
  }, {})

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(inputCls, 'flex items-center justify-between text-left cursor-pointer')}
      >
        <div className="flex items-center gap-2 min-w-0">
          {selected ? (
            <>
              <Badge variant="muted" className="text-[10px] shrink-0">{selected.provider}</Badge>
              <span className="truncate">{selected.display_name}</span>
              <span className="text-[11px] text-muted-foreground font-mono truncate hidden sm:inline">{selected.model_id}</span>
            </>
          ) : (
            <>
              <span className="truncate">{value}</span>
              <span className="text-[11px] text-muted-foreground">(custom)</span>
            </>
          )}
        </div>
        <ChevronDown className={cn('size-4 text-muted-foreground shrink-0 ml-2 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-xl border bg-card shadow-lg overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search models..."
                className="w-full rounded-lg border bg-background pl-8 pr-3 py-1.5 text-[12px] outline-none focus:ring-2 focus:ring-foreground/20"
              />
            </div>
          </div>

          {/* Model list */}
          <div className="max-h-64 overflow-auto">
            {Object.keys(grouped).length === 0 ? (
              <div className="py-6 text-center text-[12px] text-muted-foreground">No models found</div>
            ) : (
              Object.entries(grouped).map(([provider, providerModels]) => (
                <div key={provider}>
                  <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/50">
                    {provider}
                  </div>
                  {providerModels.map((m) => {
                    const isSelected = m.model_id === value
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => { onChange(m.model_id); setOpen(false); setSearch('') }}
                        className={cn(
                          'w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors',
                          isSelected ? 'bg-foreground/5' : 'hover:bg-muted/50',
                        )}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium truncate">{m.display_name}</p>
                          <p className="text-[11px] text-muted-foreground font-mono truncate">{m.model_id}</p>
                        </div>
                        {m.context_window && (
                          <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                            {(m.context_window / 1000).toFixed(0)}K
                          </span>
                        )}
                        {isSelected && <Check className="size-4 text-foreground shrink-0" />}
                      </button>
                    )
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Tab type ───────────────────────────────────────────────────────

type Tab = 'browser' | 'llm' | 'agents'

// ─── Main ───────────────────────────────────────────────────────────

export function ConfigurationClient({
  models, envConfig, proxies, profiles, sessions,
  agentDefaults, integrations, systemSettings, workspaces,
}: {
  models: LLMModel[]
  envConfig: EnvConfig
  proxies: BrowserProxy[]
  profiles: BrowserProfile[]
  sessions: BrowserSession[]
  agentDefaults: AgentDefaults
  integrations: IntegrationSummary[]
  systemSettings: SystemSettings
  workspaces: { id: string; name: string }[]
}) {
  const [tab, setTab] = React.useState<Tab>('browser')

  const tabs: { key: Tab; label: string }[] = [
    { key: 'browser', label: 'Browser' },
    { key: 'llm', label: 'LLM Models' },
    { key: 'agents', label: 'Agent Config' },
  ]

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b bg-card">
        <div className="flex items-center justify-between px-6 py-5">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Configuration</h1>
            <p className="text-[12px] text-muted-foreground mt-0.5">System services, LLM models, and platform settings</p>
          </div>
        </div>
        <div className="flex items-center gap-0 px-6 -mb-px">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors',
                tab === t.key ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >{t.label}</button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {tab === 'browser' && (
          <BrowserTab profiles={profiles} sessions={sessions} proxies={proxies}
            envConfig={envConfig} systemSettings={systemSettings} workspaces={workspaces} models={models} />
        )}
        {tab === 'llm' && <LLMTab models={models} gateway={envConfig.gateway} />}
        {tab === 'agents' && <AgentsTab defaults={agentDefaults} />}
      </div>
    </div>
  )
}

// ─── Browser Tab ────────────────────────────────────────────────────

function BrowserTab({
  profiles, sessions, proxies, envConfig, systemSettings, workspaces, models,
}: {
  profiles: BrowserProfile[]; sessions: BrowserSession[]
  proxies: BrowserProxy[]; envConfig: EnvConfig
  systemSettings: SystemSettings; workspaces: { id: string; name: string }[]
  models: LLMModel[]
}) {
  const router = useRouter()
  const [showProxyForm, setShowProxyForm] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  // Browser agent settings
  const [browserModel, setBrowserModel] = React.useState(systemSettings.browser_agent_model)
  const [browserPrompt, setBrowserPrompt] = React.useState(systemSettings.browser_agent_prompt)
  const [settingsSaved, setSettingsSaved] = React.useState(false)

  async function saveBrowserSettings() {
    setSaving(true)
    await updateSystemSetting('browser_agent_model', browserModel)
    await updateSystemSetting('browser_agent_prompt', browserPrompt)
    setSaving(false)
    setSettingsSaved(true)
    setTimeout(() => setSettingsSaved(false), 2000)
  }

  // Proxy form — accepts format: username:password@host:port
  const [proxyForm, setProxyForm] = React.useState({
    workspace_id: '', label: '', proxy: '', protocol: 'http', country: '', city: '',
    // Auto-parsed fields (read-only display)
    _username: '', _password: '', _host: '', _port: '',
  })
  const [proxyError, setProxyError] = React.useState('')
  const [proxyParsed, setProxyParsed] = React.useState(false)

  function parseProxy(raw: string) {
    // Format: username:password@host:port
    const match = raw.trim().match(/^([^:]+):([^@]+)@([^:]+):(\d+)$/)
    if (!match) return null
    return { username: match[1], password: match[2], host: match[3], port: parseInt(match[4]) }
  }

  function handleProxyPaste(value: string) {
    const parsed = parseProxy(value)
    if (parsed) {
      setProxyForm((prev) => ({
        ...prev,
        proxy: value.trim(),
        _username: parsed.username,
        _password: parsed.password,
        _host: parsed.host,
        _port: String(parsed.port),
        // Auto-generate label from host
        label: prev.label || parsed.host,
      }))
      setProxyParsed(true)
      setProxyError('')
    } else {
      setProxyForm((prev) => ({
        ...prev, proxy: value,
        _username: '', _password: '', _host: '', _port: '',
      }))
      setProxyParsed(false)
      if (value.trim().length > 5) {
        setProxyError('Invalid format. Use: username:password@host:port')
      }
    }
  }

  async function handleAddProxy(e: React.FormEvent) {
    e.preventDefault()
    const parsed = parseProxy(proxyForm.proxy)
    if (!parsed) {
      setProxyError('Invalid format. Use: username:password@host:port')
      return
    }
    setProxyError('')
    await createBrowserProxy({
      label: proxyForm.label,
      protocol: proxyForm.protocol,
      country: proxyForm.country || undefined,
      city: proxyForm.city || undefined,
      ...parsed,
    })
    setShowProxyForm(false)
    setProxyForm({ workspace_id: '', label: '', proxy: '', protocol: 'http', country: '', city: '', _username: '', _password: '', _host: '', _port: '' })
    setProxyParsed(false)
    router.refresh()
  }

  async function handleDeleteProxy(id: string) {
    await deleteBrowserProxy(id)
    router.refresh()
  }

  async function handleToggleProxy(id: string, active: boolean) {
    await toggleBrowserProxy(id, !active)
    router.refresh()
  }

  const activeSessions = sessions.filter((s) => s.status === 'active' || s.status === 'starting')

  return (
    <div className="space-y-6">
      {/* Browser Agent LLM + System Prompt */}
      <div className="rounded-xl border bg-card">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div>
            <h3 className="text-[14px] font-semibold">Browser Agent Settings</h3>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              Configure the LLM model and system prompt used by the browser agent tool
            </p>
          </div>
          <button
            onClick={saveBrowserSettings}
            disabled={saving}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12px] font-medium transition-colors',
              settingsSaved
                ? 'bg-emerald-600 text-white'
                : 'bg-foreground text-background hover:bg-foreground/90',
            )}
          >
            {settingsSaved ? <><CheckCircle2 className="size-3.5" /> Saved</> : <><Save className="size-3.5" /> Save Settings</>}
          </button>
        </div>
        <div className="p-5 space-y-4">
          <FormField label="Browser Agent Model">
            <ModelPicker
              value={browserModel}
              onChange={setBrowserModel}
              models={models}
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Select which LLM model the browser agent uses. Only active models are shown.
            </p>
          </FormField>
          <FormField label="Custom System Prompt (optional)">
            <textarea
              value={browserPrompt}
              onChange={(e) => setBrowserPrompt(e.target.value)}
              placeholder="Leave empty to use default browser agent prompt. Add custom instructions here to append to the built-in prompt..."
              rows={4}
              className={cn(inputCls, 'resize-none')}
            />
          </FormField>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-[11px] text-muted-foreground mb-1">Service URL</p>
          <p className="text-[13px] font-mono font-medium truncate">{envConfig.browserServiceUrl}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-[11px] text-muted-foreground mb-1">Browser Profiles</p>
          <p className="text-2xl font-bold">{profiles.length}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-[11px] text-muted-foreground mb-1">Active Sessions</p>
          <p className="text-2xl font-bold">{activeSessions.length}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-[11px] text-muted-foreground mb-1">Proxies</p>
          <p className="text-2xl font-bold">{proxies.length}</p>
        </div>
      </div>

      {/* Browser Proxies with Add */}
      <div className="rounded-xl border bg-card">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div>
            <h3 className="text-[14px] font-semibold flex items-center gap-2">
              <Network className="size-4 text-muted-foreground" />Browser Proxies
            </h3>
            <p className="text-[12px] text-muted-foreground mt-0.5">Route browser traffic through proxy servers</p>
          </div>
          <button
            onClick={() => setShowProxyForm(!showProxyForm)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-foreground text-background px-3 py-1.5 text-[12px] font-medium hover:bg-foreground/90 transition-colors"
          >
            {showProxyForm ? <X className="size-3.5" /> : <Plus className="size-3.5" />}
            {showProxyForm ? 'Cancel' : 'Add Proxy'}
          </button>
        </div>

        {/* Add Proxy Modal */}
        {showProxyForm && (
          <>
            <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={() => setShowProxyForm(false)} />
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <form onSubmit={handleAddProxy} onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-2xl border bg-card shadow-2xl overflow-hidden">
                {/* Modal Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b">
                  <div>
                    <h3 className="text-[15px] font-semibold">Add Proxy</h3>
                    <p className="text-[12px] text-muted-foreground mt-0.5">Paste your proxy and fields auto-fill</p>
                  </div>
                  <button type="button" onClick={() => setShowProxyForm(false)} className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                    <X className="size-4" />
                  </button>
                </div>

                <div className="p-6 space-y-4">
                  {/* Main paste field */}
                  <FormField label="Paste Proxy *">
                    <input
                      autoFocus
                      required
                      value={proxyForm.proxy}
                      onChange={(e) => handleProxyPaste(e.target.value)}
                      className={cn(inputCls, 'font-mono text-[14px] py-3', proxyError && 'border-red-500', proxyParsed && 'border-emerald-500')}
                      placeholder="username:password@host:port"
                    />
                    {proxyError ? (
                      <p className="text-[11px] text-red-500 mt-1">{proxyError}</p>
                    ) : proxyParsed ? (
                      <p className="text-[11px] text-emerald-600 mt-1 flex items-center gap-1"><CheckCircle2 className="size-3" /> Proxy parsed successfully</p>
                    ) : (
                      <p className="text-[11px] text-muted-foreground mt-1">Format: username:password@host:port</p>
                    )}
                  </FormField>

                  {/* Auto-filled preview */}
                  {proxyParsed && (
                    <div className="rounded-lg border bg-muted/30 p-3 grid grid-cols-2 gap-2 text-[12px]">
                      <div><span className="text-muted-foreground">Username:</span> <span className="font-mono font-medium">{proxyForm._username}</span></div>
                      <div><span className="text-muted-foreground">Password:</span> <span className="font-mono font-medium">{'*'.repeat(Math.min(proxyForm._password.length, 12))}</span></div>
                      <div><span className="text-muted-foreground">Host:</span> <span className="font-mono font-medium">{proxyForm._host}</span></div>
                      <div><span className="text-muted-foreground">Port:</span> <span className="font-mono font-medium">{proxyForm._port}</span></div>
                    </div>
                  )}

                  {/* Additional fields */}
                  <div className="grid grid-cols-2 gap-4">
                    <FormField label="Label *">
                      <input required value={proxyForm.label} onChange={(e) => setProxyForm({ ...proxyForm, label: e.target.value })} className={inputCls} placeholder="US Proxy 1" />
                    </FormField>
                    <FormField label="Protocol">
                      <select value={proxyForm.protocol} onChange={(e) => setProxyForm({ ...proxyForm, protocol: e.target.value })} className={selectCls}>
                        <option value="http">HTTP</option>
                        <option value="https">HTTPS</option>
                        <option value="socks5">SOCKS5</option>
                      </select>
                    </FormField>
                    <FormField label="Country">
                      <input value={proxyForm.country} onChange={(e) => setProxyForm({ ...proxyForm, country: e.target.value })} className={inputCls} placeholder="US" />
                    </FormField>
                    <FormField label="City">
                      <input value={proxyForm.city} onChange={(e) => setProxyForm({ ...proxyForm, city: e.target.value })} className={inputCls} placeholder="New York" />
                    </FormField>
                  </div>
                </div>

                {/* Modal Footer */}
                <div className="flex items-center justify-end gap-2 px-6 py-4 border-t bg-muted/20">
                  <button type="button" onClick={() => setShowProxyForm(false)} className="rounded-lg border px-4 py-2 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors">
                    Cancel
                  </button>
                  <button type="submit" disabled={!proxyParsed} className="inline-flex items-center gap-1.5 rounded-lg bg-foreground text-background px-4 py-2 text-[12px] font-medium disabled:opacity-50 disabled:cursor-not-allowed">
                    <Plus className="size-3.5" /> Add Proxy
                  </button>
                </div>
              </form>
            </div>
          </>
        )}

        {/* Proxy Table */}
        {proxies.length === 0 && !showProxyForm ? (
          <div className="flex items-center justify-center py-12 text-[13px] text-muted-foreground">No proxies configured</div>
        ) : proxies.length > 0 && (
          <div className="overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Label</th>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Proxy</th>
                  <th className="px-5 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Protocol</th>
                  <th className="px-5 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Location</th>
                  <th className="px-5 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                  <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {proxies.map((p) => (
                  <tr key={p.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="px-5 py-3 font-semibold">{p.label}</td>
                    <td className="px-5 py-3">
                      <code className="text-[11px] font-mono bg-muted rounded px-1.5 py-0.5">{p.username}:****@{p.host}:{p.port}</code>
                    </td>
                    <td className="px-5 py-3 text-center">
                      <Badge variant="muted" className="text-[10px]">{p.protocol.toUpperCase()}</Badge>
                    </td>
                    <td className="px-5 py-3 text-center text-[12px]">
                      {p.country || p.city ? `${p.city || ''}${p.city && p.country ? ', ' : ''}${p.country || ''}` : '—'}
                    </td>
                    <td className="px-5 py-3 text-center">
                      <button onClick={() => handleToggleProxy(p.id, p.is_active)} className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium cursor-pointer transition-colors',
                        p.is_active ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200',
                      )}>
                        <span className={cn('size-1.5 rounded-full', p.is_active ? 'bg-emerald-500' : 'bg-zinc-400')} />
                        {p.is_active ? 'Active' : 'Disabled'}
                      </button>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button onClick={() => handleDeleteProxy(p.id)}
                        className="rounded-md p-1.5 text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-colors">
                        <Trash2 className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Profiles & Sessions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border bg-card">
          <div className="px-5 py-4 border-b">
            <h3 className="text-[14px] font-semibold flex items-center gap-2"><Monitor className="size-4 text-muted-foreground" />Browser Profiles</h3>
            <p className="text-[12px] text-muted-foreground mt-0.5">{profiles.length} profile{profiles.length !== 1 ? 's' : ''}</p>
          </div>
          {profiles.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-[13px] text-muted-foreground">No profiles yet</div>
          ) : (
            <div className="divide-y max-h-72 overflow-auto">
              {profiles.map((p) => (
                <div key={p.id} className="flex items-center justify-between px-5 py-3">
                  <div className="flex items-center gap-3">
                    <span className="flex size-8 items-center justify-center rounded-lg bg-muted"><Monitor className="size-3.5 text-muted-foreground" /></span>
                    <div>
                      <p className="text-[13px] font-medium">{p.name}</p>
                      <p className="text-[11px] text-muted-foreground">{p.workspace_name} {p.agent_name ? `· ${p.agent_name}` : ''}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="muted" className="text-[10px]">{p.os}</Badge>
                    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                      p.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-500')}>
                      <span className={cn('size-1.5 rounded-full', p.status === 'active' ? 'bg-emerald-500' : 'bg-zinc-400')} />
                      {p.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border bg-card">
          <div className="px-5 py-4 border-b">
            <h3 className="text-[14px] font-semibold flex items-center gap-2"><Globe className="size-4 text-muted-foreground" />Recent Sessions</h3>
            <p className="text-[12px] text-muted-foreground mt-0.5">{activeSessions.length} active · {sessions.length} total</p>
          </div>
          {sessions.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-[13px] text-muted-foreground">No sessions yet</div>
          ) : (
            <div className="divide-y max-h-72 overflow-auto">
              {sessions.map((s) => {
                const isActive = s.status === 'active' || s.status === 'starting'
                return (
                  <div key={s.id} className="flex items-center justify-between px-5 py-3">
                    <div>
                      <p className="text-[13px] font-medium">{s.profile_name || 'Unknown'}</p>
                      <p className="text-[11px] text-muted-foreground">{s.workspace_name} {s.agent_name ? `· ${s.agent_name}` : ''} · {fmtDate(s.created_at)}</p>
                    </div>
                    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                      isActive ? 'bg-blue-50 text-blue-700' : s.status === 'closed' ? 'bg-zinc-100 text-zinc-500' : 'bg-red-50 text-red-700')}>
                      <span className={cn('size-1.5 rounded-full', isActive ? 'bg-blue-500' : s.status === 'closed' ? 'bg-zinc-400' : 'bg-red-500')} />
                      {s.status}
                    </span>
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

// ─── LLM Models Tab ─────────────────────────────────────────────────

const emptyModel = {
  model_id: '', display_name: '', provider: 'openrouter' as string,
  description: '', multiplier: 1, context_window: 0,
  is_active: true, minimum_plan: 'pro', is_featured: false, sort_order: 0,
}

function LLMTab({ models, gateway }: { models: LLMModel[]; gateway: string }) {
  const router = useRouter()
  const [filter, setFilter] = React.useState<'all' | 'active' | 'disabled'>('all')
  const [showForm, setShowForm] = React.useState(false)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [form, setForm] = React.useState(emptyModel)

  const filtered = models.filter((m) => {
    if (filter === 'active') return m.is_active
    if (filter === 'disabled') return !m.is_active
    return true
  })

  function startEdit(m: LLMModel) {
    setEditingId(m.id)
    setForm({
      model_id: m.model_id, display_name: m.display_name, provider: m.provider,
      description: m.description || '', multiplier: m.multiplier,
      context_window: m.context_window || 0, is_active: m.is_active,
      minimum_plan: m.minimum_plan, is_featured: m.is_featured, sort_order: m.sort_order,
    })
    setShowForm(true)
  }

  function startCreate() {
    setEditingId(null)
    setForm(emptyModel)
    setShowForm(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const data = {
      ...form,
      context_window: form.context_window || undefined,
      description: form.description || undefined,
    }
    if (editingId) {
      await updateLLMModel(editingId, data)
    } else {
      await createLLMModel(data)
    }
    setShowForm(false)
    router.refresh()
  }

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this model?')) return
    await deleteLLMModel(id)
    router.refresh()
  }

  async function handleToggle(id: string, active: boolean) {
    await toggleLLMModel(id, !active)
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-foreground text-background px-3 py-1.5 text-[12px] font-semibold">
            <Zap className="size-3.5" />Gateway: {gateway || 'OpenRouter'}
          </span>
          <span className="text-[12px] text-muted-foreground">
            {models.length} models &middot; {models.filter((m) => m.is_active).length} active
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border bg-card p-0.5">
            {(['all', 'active', 'disabled'] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className={cn('rounded-md px-3 py-1 text-[12px] font-medium transition-colors',
                  filter === f ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground')}>
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          <button onClick={() => showForm ? setShowForm(false) : startCreate()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-foreground text-background px-3 py-1.5 text-[12px] font-medium hover:bg-foreground/90">
            {showForm ? <X className="size-3.5" /> : <Plus className="size-3.5" />}
            {showForm ? 'Cancel' : 'Add Model'}
          </button>
        </div>
      </div>

      {/* Model Form Modal */}
      {showForm && (
        <>
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={() => setShowForm(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <form onSubmit={handleSubmit} onClick={(e) => e.stopPropagation()} className="w-full max-w-2xl rounded-2xl border bg-card shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b">
                <div>
                  <h3 className="text-[15px] font-semibold">{editingId ? 'Edit Model' : 'Add New Model'}</h3>
                  <p className="text-[12px] text-muted-foreground mt-0.5">{editingId ? 'Update model configuration' : 'Add a new LLM model to the platform'}</p>
                </div>
                <button type="button" onClick={() => setShowForm(false)} className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                  <X className="size-4" />
                </button>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <FormField label="Model ID *">
                    <input autoFocus required value={form.model_id} onChange={(e) => setForm({ ...form, model_id: e.target.value })} className={inputCls} placeholder="openai/gpt-4o" />
                  </FormField>
                  <FormField label="Display Name *">
                    <input required value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} className={inputCls} placeholder="GPT-4o" />
                  </FormField>
                  <FormField label="Provider *">
                    <select value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} className={selectCls}>
                      <option value="openrouter">OpenRouter</option>
                      <option value="openai">OpenAI</option>
                      <option value="anthropic">Anthropic</option>
                      <option value="google">Google</option>
                    </select>
                  </FormField>
                  <FormField label="Multiplier">
                    <input type="number" step="0.01" value={form.multiplier} onChange={(e) => setForm({ ...form, multiplier: parseFloat(e.target.value) || 1 })} className={inputCls} />
                  </FormField>
                  <FormField label="Context Window">
                    <input type="number" value={form.context_window || ''} onChange={(e) => setForm({ ...form, context_window: parseInt(e.target.value) || 0 })} className={inputCls} placeholder="128000" />
                  </FormField>
                  <FormField label="Min Plan">
                    <select value={form.minimum_plan} onChange={(e) => setForm({ ...form, minimum_plan: e.target.value })} className={selectCls}>
                      <option value="free">Free</option>
                      <option value="pro">Pro</option>
                      <option value="business">Business</option>
                      <option value="enterprise">Enterprise</option>
                    </select>
                  </FormField>
                  <FormField label="Sort Order">
                    <input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })} className={inputCls} />
                  </FormField>
                  <FormField label="Description">
                    <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputCls} placeholder="Optional description" />
                  </FormField>
                  <div className="flex items-end gap-4">
                    <label className="flex items-center gap-2 text-[13px]">
                      <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="rounded" />
                      Active
                    </label>
                    <label className="flex items-center gap-2 text-[13px]">
                      <input type="checkbox" checked={form.is_featured} onChange={(e) => setForm({ ...form, is_featured: e.target.checked })} className="rounded" />
                      Featured
                    </label>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 px-6 py-4 border-t bg-muted/20">
                <button type="button" onClick={() => setShowForm(false)} className="rounded-lg border px-4 py-2 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors">
                  Cancel
                </button>
                <button type="submit" className="inline-flex items-center gap-1.5 rounded-lg bg-foreground text-background px-4 py-2 text-[12px] font-medium">
                  <Save className="size-3.5" /> {editingId ? 'Update Model' : 'Add Model'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}

      {/* Models Table */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Model</th>
              <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Provider</th>
              <th className="px-5 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Context</th>
              <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Multiplier</th>
              <th className="px-5 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Plan</th>
              <th className="px-5 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
              <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="py-16 text-center text-muted-foreground">No models found</td></tr>
            ) : filtered.map((m) => (
              <tr key={m.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <div>
                      <p className="font-semibold">{m.display_name}</p>
                      <p className="text-[11px] text-muted-foreground font-mono">{m.model_id}</p>
                    </div>
                    {m.is_featured && <Zap className="size-3.5 text-amber-500" />}
                  </div>
                </td>
                <td className="px-5 py-3"><Badge variant="muted" className="text-[10px] font-medium">{m.provider}</Badge></td>
                <td className="px-5 py-3 text-center">
                  {m.context_window ? <span className="text-[12px] font-mono text-muted-foreground">{(m.context_window / 1000).toFixed(0)}K</span> : <span className="text-muted-foreground/40">—</span>}
                </td>
                <td className="px-5 py-3 text-right font-mono tabular-nums text-[12px] font-semibold">{m.multiplier}x</td>
                <td className="px-5 py-3 text-center"><Badge variant="muted" className="text-[10px]">{m.minimum_plan}</Badge></td>
                <td className="px-5 py-3 text-center">
                  <button onClick={() => handleToggle(m.id, m.is_active)} className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium cursor-pointer transition-colors',
                    m.is_active ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200')}>
                    <span className={cn('size-1.5 rounded-full', m.is_active ? 'bg-emerald-500' : 'bg-zinc-400')} />
                    {m.is_active ? 'Active' : 'Disabled'}
                  </button>
                </td>
                <td className="px-5 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => startEdit(m)} className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                      <Edit2 className="size-3.5" />
                    </button>
                    <button onClick={() => handleDelete(m.id)} className="rounded-md p-1.5 text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-colors">
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Agent Config Tab ───────────────────────────────────────────────

function AgentsTab({ defaults }: { defaults: AgentDefaults }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard label="Total Agents" value={defaults.total_agents} icon={Bot} accent="text-blue-600 bg-blue-50" />
        <SummaryCard label="System Access" value={defaults.system_access_count} icon={Shield} accent="text-amber-600 bg-amber-50" />
        <SummaryCard label="Approval Required" value={defaults.approval_required_count} icon={Lock} accent="text-red-600 bg-red-50" />
        <SummaryCard label="KB Management" value={defaults.can_manage_kb_count} icon={Database} accent="text-violet-600 bg-violet-50" />
      </div>
      <div className="rounded-xl border bg-card">
        <div className="px-5 py-4 border-b">
          <h3 className="text-[14px] font-semibold">Models Used by Agents</h3>
        </div>
        {defaults.models_in_use.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-[13px] text-muted-foreground">No agents configured</div>
        ) : (
          <div className="divide-y">
            {defaults.models_in_use.map((m) => {
              const pct = defaults.total_agents > 0 ? Math.round((m.count / defaults.total_agents) * 100) : 0
              return (
                <div key={m.model} className="flex items-center gap-4 px-5 py-3.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1.5">
                      <code className="text-[12px] font-mono font-medium truncate">{m.model}</code>
                      <span className="text-[12px] text-muted-foreground shrink-0 ml-3">{m.count} agent{m.count !== 1 ? 's' : ''} ({pct}%)</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-foreground transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      <div className="rounded-xl border bg-card">
        <div className="px-5 py-4 border-b">
          <h3 className="text-[14px] font-semibold">Capabilities Overview</h3>
        </div>
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <CapabilityBar label="System Level Access" count={defaults.system_access_count} total={defaults.total_agents} color="bg-amber-500" icon={Shield} />
          <CapabilityBar label="KB Management" count={defaults.can_manage_kb_count} total={defaults.total_agents} color="bg-violet-500" icon={Database} />
          <CapabilityBar label="Requires Approval" count={defaults.approval_required_count} total={defaults.total_agents} color="bg-red-500" icon={Lock} />
          <CapabilityBar label="No Approval" count={defaults.total_agents - defaults.approval_required_count} total={defaults.total_agents} color="bg-emerald-500" icon={Unlock} />
        </div>
      </div>
    </div>
  )
}

function SummaryCard({ label, value, icon: Icon, accent }: { label: string; value: number; icon: React.ElementType; accent: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <span className={cn('flex size-8 items-center justify-center rounded-lg mb-3', accent)}><Icon className="size-4" /></span>
      <p className="text-2xl font-bold tracking-tight">{value}</p>
      <p className="text-[12px] text-muted-foreground mt-0.5">{label}</p>
    </div>
  )
}

function CapabilityBar({ label, count, total, color, icon: Icon }: { label: string; count: number; total: number; color: string; icon: React.ElementType }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-8 items-center justify-center rounded-lg bg-muted shrink-0"><Icon className="size-3.5 text-muted-foreground" /></span>
      <div className="flex-1">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[12px] font-medium">{label}</span>
          <span className="text-[11px] text-muted-foreground">{count}/{total} ({pct}%)</span>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  )
}

// ─── Integrations Tab ───────────────────────────────────────────────

function IntegrationsTab({ integrations }: { integrations: IntegrationSummary[] }) {
  return (
    <div className="rounded-xl border bg-card">
      <div className="px-5 py-4 border-b">
        <h3 className="text-[14px] font-semibold flex items-center gap-2"><Plug className="size-4 text-muted-foreground" />Connected Integrations</h3>
        <p className="text-[12px] text-muted-foreground mt-0.5">{integrations.length} type{integrations.length !== 1 ? 's' : ''}</p>
      </div>
      {integrations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Plug className="size-8 opacity-20 mb-2" />
          <p className="text-[13px]">No integrations configured</p>
        </div>
      ) : (
        <div className="divide-y">
          {integrations.map((intg) => (
            <div key={intg.toolkit_slug} className="flex items-center justify-between px-5 py-3.5">
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-lg bg-muted font-mono text-[12px] font-bold text-muted-foreground uppercase">
                  {intg.toolkit_slug.slice(0, 2)}
                </span>
                <div>
                  <p className="text-[13px] font-semibold capitalize">{intg.toolkit_slug.replace(/_/g, ' ')}</p>
                  <p className="text-[11px] text-muted-foreground">{intg.count} connection{intg.count !== 1 ? 's' : ''}</p>
                </div>
              </div>
              <Badge variant="muted" className="text-[10px]">{intg.toolkit_slug}</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
