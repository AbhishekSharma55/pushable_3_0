'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  Send, Hash, Eye, EyeOff, CheckCircle2, XCircle, AlertCircle,
  RefreshCw, Save, Wifi, WifiOff, Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  upsertPlatformBotConfig,
  testPlatformBotConnection,
  restartPlatformBot,
} from '@/app/actions/platform-bots'
import type { PlatformBotConfig } from '@/app/actions/platform-bots'

// ─── Helpers ────────────────────────────────────────────────────────

const inputCls = 'w-full rounded-lg border bg-background px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-foreground/20'

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: 'bg-emerald-50 text-emerald-700',
    inactive: 'bg-zinc-100 text-zinc-600',
    error: 'bg-red-50 text-red-700',
  }
  const icons: Record<string, React.ReactNode> = {
    active: <CheckCircle2 className="size-3" />,
    inactive: <WifiOff className="size-3" />,
    error: <XCircle className="size-3" />,
  }
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize',
      styles[status] || styles.inactive,
    )}>
      {icons[status] || icons.inactive}
      {status}
    </span>
  )
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12px] font-medium text-muted-foreground mb-1">{label}</label>
      {children}
    </div>
  )
}

function PasswordInput({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder?: string
}) {
  const [show, setShow] = React.useState(false)
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={inputCls}
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
      >
        {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </button>
    </div>
  )
}

function FormattedDate({ value }: { value: string | null }) {
  const [text, setText] = React.useState('—')
  React.useEffect(() => {
    if (value) {
      setText(new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))
    }
  }, [value])
  return <>{text}</>
}

// ─── Main ───────────────────────────────────────────────────────────

export function PlatformBotsClient({ configs }: { configs: PlatformBotConfig[] }) {
  const router = useRouter()
  const telegramConfig = configs.find((c) => c.platform === 'telegram')
  const slackConfig = configs.find((c) => c.platform === 'slack')

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b bg-card">
        <div className="flex items-center justify-between px-6 py-5">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Platform Bots</h1>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              Configure universal bot tokens for Telegram and Slack platforms
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <TelegramCard config={telegramConfig} onRefresh={() => router.refresh()} />
          <SlackCard config={slackConfig} onRefresh={() => router.refresh()} />
        </div>
      </div>
    </div>
  )
}

// ─── Telegram Card ──────────────────────────────────────────────────

function TelegramCard({ config, onRefresh }: { config?: PlatformBotConfig; onRefresh: () => void }) {
  const [botToken, setBotToken] = React.useState('')
  const [testing, setTesting] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [testResult, setTestResult] = React.useState<{ success: boolean; botName?: string; botUsername?: string; error?: string } | null>(null)
  const [toast, setToast] = React.useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  const hasExisting = !!config?.config_masked?.botToken
  const hasChanges = botToken.length > 0

  async function handleTest() {
    if (!botToken) return
    setTesting(true)
    setTestResult(null)
    try {
      const result = await testPlatformBotConnection('telegram', { botToken })
      setTestResult(result)
    } catch (err: any) {
      setTestResult({ success: false, error: typeof err?.message === 'string' ? err.message : 'Connection test failed' })
    }
    setTesting(false)
  }

  async function handleSaveAndRestart() {
    if (!botToken) return
    setSaving(true)
    setToast(null)
    try {
      await upsertPlatformBotConfig('telegram', { botToken })
      const restart = await restartPlatformBot('telegram')
      if (restart.success) {
        setToast({ type: 'success', msg: 'Telegram bot saved and restarted successfully' })
        setBotToken('')
        onRefresh()
      } else {
        setToast({ type: 'error', msg: typeof restart.error === 'string' ? restart.error : 'Restart failed' })
      }
    } catch (err: any) {
      setToast({ type: 'error', msg: typeof err?.message === 'string' ? err.message : 'Failed to save configuration' })
    }
    setSaving(false)
  }

  return (
    <div className="rounded-xl border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-blue-50">
            <Send className="size-4 text-blue-600" />
          </div>
          <div>
            <h2 className="text-[14px] font-semibold">Telegram</h2>
            <p className="text-[11px] text-muted-foreground">Platform universal bot</p>
          </div>
        </div>
        <StatusBadge status={config?.status || 'inactive'} />
      </div>

      {/* Bot Info */}
      {(config?.bot_username || config?.bot_name) && (
        <div className="border-b px-5 py-3 bg-muted/30">
          <div className="flex items-center gap-2">
            <Wifi className="size-3.5 text-emerald-600" />
            <span className="text-[12px] font-medium">
              {config.bot_name && <span>{config.bot_name}</span>}
              {config.bot_username && <span className="text-muted-foreground"> @{config.bot_username}</span>}
            </span>
          </div>
        </div>
      )}

      {/* Error */}
      {config?.status === 'error' && config.error_message && (
        <div className="border-b px-5 py-3 bg-red-50/50">
          <div className="flex items-start gap-2">
            <AlertCircle className="size-3.5 text-red-600 mt-0.5 shrink-0" />
            <span className="text-[12px] text-red-700">{config.error_message}</span>
          </div>
        </div>
      )}

      {/* Form */}
      <div className="space-y-4 px-5 py-4">
        <FormField label="Bot Token">
          <PasswordInput
            value={botToken}
            onChange={setBotToken}
            placeholder={hasExisting ? config!.config_masked.botToken : 'Enter Telegram bot token...'}
          />
          {hasExisting && !hasChanges && (
            <p className="mt-1 text-[11px] text-muted-foreground">Token is configured. Enter a new token to change it.</p>
          )}
        </FormField>

        {/* Test Result */}
        {testResult && (
          <div className={cn(
            'rounded-lg px-4 py-3 text-[12px]',
            testResult.success ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800',
          )}>
            {testResult.success ? (
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-3.5" />
                <span>Connected: <strong>{testResult.botName}</strong> (@{testResult.botUsername})</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <XCircle className="size-3.5" />
                <span>{testResult.error}</span>
              </div>
            )}
          </div>
        )}

        {/* Toast */}
        {toast && (
          <div className={cn(
            'rounded-lg px-4 py-3 text-[12px]',
            toast.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800',
          )}>
            {toast.msg}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between border-t px-5 py-3">
        <span className="text-[11px] text-muted-foreground">
          {config?.updated_at ? <>Updated <FormattedDate value={config.updated_at} /></> : 'Not configured'}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={handleTest}
            disabled={!hasChanges || testing}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors',
              hasChanges && !testing
                ? 'border hover:bg-muted text-foreground'
                : 'border text-muted-foreground cursor-not-allowed opacity-50',
            )}
          >
            {testing ? <Loader2 className="size-3 animate-spin" /> : <Wifi className="size-3" />}
            Test
          </button>
          <button
            onClick={handleSaveAndRestart}
            disabled={!hasChanges || saving}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors',
              hasChanges && !saving
                ? 'bg-foreground text-background hover:bg-foreground/90'
                : 'bg-muted text-muted-foreground cursor-not-allowed',
            )}
          >
            {saving ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
            Save & Restart
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Slack Card ─────────────────────────────────────────────────────

function SlackCard({ config, onRefresh }: { config?: PlatformBotConfig; onRefresh: () => void }) {
  const [clientId, setClientId] = React.useState('')
  const [clientSecret, setClientSecret] = React.useState('')
  const [signingSecret, setSigningSecret] = React.useState('')
  const [botToken, setBotToken] = React.useState('')
  const [testing, setTesting] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [testResult, setTestResult] = React.useState<{ success: boolean; teamName?: string; botUsername?: string; error?: string } | null>(null)
  const [toast, setToast] = React.useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  const hasExisting = !!config?.config_masked?.clientId
  const hasChanges = clientId.length > 0 || clientSecret.length > 0 || signingSecret.length > 0 || botToken.length > 0

  async function handleTest() {
    if (!botToken) return
    setTesting(true)
    setTestResult(null)
    try {
      const result = await testPlatformBotConnection('slack', { botToken })
      setTestResult(result)
    } catch (err: any) {
      setTestResult({ success: false, error: typeof err?.message === 'string' ? err.message : 'Connection test failed' })
    }
    setTesting(false)
  }

  async function handleSaveAndRestart() {
    // For Slack, we need at minimum the three core secrets
    // Allow partial updates by merging with existing config
    const newConfig: Record<string, string> = {}

    if (clientId) newConfig.clientId = clientId
    else if (config?.config?.clientId) newConfig.clientId = String(config.config.clientId)

    if (clientSecret) newConfig.clientSecret = clientSecret
    else if (config?.config?.clientSecret) newConfig.clientSecret = String(config.config.clientSecret)

    if (signingSecret) newConfig.signingSecret = signingSecret
    else if (config?.config?.signingSecret) newConfig.signingSecret = String(config.config.signingSecret)

    if (botToken) newConfig.botToken = botToken
    else if (config?.config?.botToken) newConfig.botToken = String(config.config.botToken)

    if (!newConfig.clientId || !newConfig.clientSecret || !newConfig.signingSecret) {
      setToast({ type: 'error', msg: 'Client ID, Client Secret, and Signing Secret are all required' })
      return
    }

    setSaving(true)
    setToast(null)
    try {
      await upsertPlatformBotConfig('slack', newConfig)
      const restart = await restartPlatformBot('slack')
      if (restart.success) {
        setToast({ type: 'success', msg: 'Slack bot saved and restarted successfully' })
        setClientId('')
        setClientSecret('')
        setSigningSecret('')
        setBotToken('')
        onRefresh()
      } else {
        setToast({ type: 'error', msg: typeof restart.error === 'string' ? restart.error : 'Restart failed' })
      }
    } catch (err: any) {
      setToast({ type: 'error', msg: typeof err?.message === 'string' ? err.message : 'Failed to save configuration' })
    }
    setSaving(false)
  }

  return (
    <div className="rounded-xl border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-purple-50">
            <Hash className="size-4 text-purple-600" />
          </div>
          <div>
            <h2 className="text-[14px] font-semibold">Slack</h2>
            <p className="text-[11px] text-muted-foreground">Platform universal bot</p>
          </div>
        </div>
        <StatusBadge status={config?.status || 'inactive'} />
      </div>

      {/* Bot Info */}
      {(config?.bot_name || config?.bot_username) && (
        <div className="border-b px-5 py-3 bg-muted/30">
          <div className="flex items-center gap-2">
            <Wifi className="size-3.5 text-emerald-600" />
            <span className="text-[12px] font-medium">
              {config.bot_name && <span>Team: {config.bot_name}</span>}
              {config.bot_username && <span className="text-muted-foreground"> ({config.bot_username})</span>}
            </span>
          </div>
        </div>
      )}

      {/* Error */}
      {config?.status === 'error' && config.error_message && (
        <div className="border-b px-5 py-3 bg-red-50/50">
          <div className="flex items-start gap-2">
            <AlertCircle className="size-3.5 text-red-600 mt-0.5 shrink-0" />
            <span className="text-[12px] text-red-700">{config.error_message}</span>
          </div>
        </div>
      )}

      {/* Form */}
      <div className="space-y-4 px-5 py-4">
        <FormField label="Client ID">
          <PasswordInput
            value={clientId}
            onChange={setClientId}
            placeholder={hasExisting ? config!.config_masked.clientId : 'Enter Slack Client ID...'}
          />
        </FormField>

        <FormField label="Client Secret">
          <PasswordInput
            value={clientSecret}
            onChange={setClientSecret}
            placeholder={config?.config_masked?.clientSecret || 'Enter Slack Client Secret...'}
          />
        </FormField>

        <FormField label="Signing Secret">
          <PasswordInput
            value={signingSecret}
            onChange={setSigningSecret}
            placeholder={config?.config_masked?.signingSecret || 'Enter Slack Signing Secret...'}
          />
        </FormField>

        <FormField label="Bot Token (optional)">
          <PasswordInput
            value={botToken}
            onChange={setBotToken}
            placeholder={config?.config_masked?.botToken || 'Enter Slack Bot Token (xoxb-...)...'}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Direct bot token for auto-registration. Leave empty if using OAuth only.
          </p>
        </FormField>

        {/* Test Result */}
        {testResult && (
          <div className={cn(
            'rounded-lg px-4 py-3 text-[12px]',
            testResult.success ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800',
          )}>
            {testResult.success ? (
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-3.5" />
                <span>Connected: Team <strong>{testResult.teamName}</strong> ({testResult.botUsername})</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <XCircle className="size-3.5" />
                <span>{testResult.error}</span>
              </div>
            )}
          </div>
        )}

        {/* Toast */}
        {toast && (
          <div className={cn(
            'rounded-lg px-4 py-3 text-[12px]',
            toast.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800',
          )}>
            {toast.msg}
          </div>
        )}

        {hasExisting && !hasChanges && (
          <p className="text-[11px] text-muted-foreground">Credentials are configured. Enter new values to update.</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between border-t px-5 py-3">
        <span className="text-[11px] text-muted-foreground">
          {config?.updated_at ? <>Updated <FormattedDate value={config.updated_at} /></> : 'Not configured'}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={handleTest}
            disabled={!botToken || testing}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors',
              botToken && !testing
                ? 'border hover:bg-muted text-foreground'
                : 'border text-muted-foreground cursor-not-allowed opacity-50',
            )}
          >
            {testing ? <Loader2 className="size-3 animate-spin" /> : <Wifi className="size-3" />}
            Test
          </button>
          <button
            onClick={handleSaveAndRestart}
            disabled={!hasChanges || saving}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors',
              hasChanges && !saving
                ? 'bg-foreground text-background hover:bg-foreground/90'
                : 'bg-muted text-muted-foreground cursor-not-allowed',
            )}
          >
            {saving ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
            Save & Restart
          </button>
        </div>
      </div>
    </div>
  )
}
