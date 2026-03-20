'use client'

import * as React from 'react'
import { Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { ArrowLeft, RefreshCw, Download, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

const TAIL_OPTIONS = [100, 200, 500, 1000, 2000]

export default function ContainerLogsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-full"><span className="size-6 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-muted-foreground" /></div>}>
      <ContainerLogsContent />
    </Suspense>
  )
}

function ContainerLogsContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const containerId = searchParams.get('id') || ''
  const containerName = searchParams.get('name') || 'Container'

  const [logs, setLogs] = React.useState('')
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [tail, setTail] = React.useState(200)
  const [autoScroll, setAutoScroll] = React.useState(true)
  const logRef = React.useRef<HTMLPreElement>(null)

  const fetchLogs = React.useCallback(async () => {
    if (!containerId) return
    try {
      setLoading(true)
      const res = await fetch(`/api/container-logs?id=${containerId}&tail=${tail}`)
      if (!res.ok) throw new Error('Failed to fetch logs')
      const json = await res.json()
      setLogs(json.logs || '')
      setError(null)
    } catch {
      setError('Failed to load container logs')
    } finally {
      setLoading(false)
    }
  }, [containerId, tail])

  React.useEffect(() => { fetchLogs() }, [fetchLogs])

  React.useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs, autoScroll])

  const handleDownload = () => {
    const blob = new Blob([logs], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${containerName}-logs.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const logLines = logs.split('\n').filter(Boolean)

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b bg-card px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.back()}
              className="flex size-8 items-center justify-center rounded-lg border hover:bg-muted transition-colors"
            >
              <ArrowLeft className="size-4" />
            </button>
            <div>
              <h1 className="text-[15px] font-semibold tracking-tight">
                {containerName.replace(/^pushable_3_0-/, '').replace(/-\d+$/, '')}
              </h1>
              <p className="text-[11px] text-muted-foreground font-mono">{containerId.slice(0, 12)}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Tail selector */}
            <div className="relative">
              <select
                value={tail}
                onChange={(e) => setTail(Number(e.target.value))}
                className="appearance-none rounded-lg border bg-card pl-3 pr-8 py-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground cursor-pointer"
              >
                {TAIL_OPTIONS.map((n) => (
                  <option key={n} value={n}>Last {n} lines</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
            </div>

            {/* Auto-scroll toggle */}
            <button
              onClick={() => setAutoScroll(!autoScroll)}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors',
                autoScroll
                  ? 'bg-foreground text-background border-foreground'
                  : 'bg-card text-muted-foreground hover:text-foreground',
              )}
            >
              Auto-scroll
            </button>

            {/* Download */}
            <button
              onClick={handleDownload}
              disabled={!logs}
              className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              <Download className="size-3.5" />
              Download
            </button>

            {/* Refresh */}
            <button
              onClick={fetchLogs}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Logs */}
      <div className="flex-1 overflow-hidden p-4">
        {error ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <p className="text-[13px]">{error}</p>
            <button onClick={fetchLogs} className="mt-2 text-[13px] font-medium hover:underline">Retry</button>
          </div>
        ) : loading && !logs ? (
          <div className="flex items-center justify-center h-full">
            <span className="size-6 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-muted-foreground" />
          </div>
        ) : (
          <pre
            ref={logRef}
            className="h-full overflow-auto rounded-xl border bg-zinc-950 text-zinc-100 p-4 text-[12px] font-mono leading-relaxed"
          >
            {logLines.length === 0 ? (
              <span className="text-zinc-500">No logs available</span>
            ) : (
              logLines.map((line, i) => {
                // Parse timestamp if present (Docker timestamps: 2024-01-01T00:00:00.000000000Z)
                const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\s(.*)/)
                const isError = line.toLowerCase().includes('error') || line.toLowerCase().includes('err ')
                const isWarn = line.toLowerCase().includes('warn') || line.toLowerCase().includes('warning')

                return (
                  <div
                    key={i}
                    className={cn(
                      'py-px hover:bg-zinc-900/50',
                      isError && 'text-red-400',
                      isWarn && 'text-amber-400',
                    )}
                  >
                    <span className="text-zinc-600 select-none mr-3">{String(i + 1).padStart(4)}</span>
                    {tsMatch ? (
                      <>
                        <span className="text-zinc-500">{new Date(tsMatch[1]).toLocaleTimeString()}</span>
                        <span className="text-zinc-600 mx-2">│</span>
                        <span>{tsMatch[2]}</span>
                      </>
                    ) : (
                      <span>{line}</span>
                    )}
                  </div>
                )
              })
            )}
          </pre>
        )}
      </div>
    </div>
  )
}
