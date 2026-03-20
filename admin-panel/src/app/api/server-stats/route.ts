import { NextResponse } from 'next/server'
import os from 'os'
import http from 'http'

export interface ContainerStat {
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
  image: string
}

export interface ServerInfo {
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

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86400)
  const hrs = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hrs}h ${mins}m`
  if (hrs > 0) return `${hrs}h ${mins}m`
  return `${mins}m`
}

function dockerRequest(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath: '/var/run/docker.sock', path, method: 'GET' },
      (res) => {
        let data = ''
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => resolve(data))
      }
    )
    req.on('error', reject)
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')) })
    req.end()
  })
}

function computeCpu(stats: Record<string, unknown>): number {
  const cpu = stats.cpu_stats as Record<string, unknown> | undefined
  const precpu = stats.precpu_stats as Record<string, unknown> | undefined
  if (!cpu || !precpu) return 0
  const cpuUsage = cpu.cpu_usage as Record<string, number> | undefined
  const precpuUsage = precpu.cpu_usage as Record<string, number> | undefined
  const systemUsage = cpu.system_cpu_usage as number | undefined
  const preSystemUsage = precpu.system_cpu_usage as number | undefined
  if (!cpuUsage || !precpuUsage || !systemUsage || !preSystemUsage) return 0
  const cpuDelta = cpuUsage.total_usage - precpuUsage.total_usage
  const sysDelta = systemUsage - preSystemUsage
  const onlineCpus = (cpu.online_cpus as number) || os.cpus().length
  if (sysDelta > 0) return (cpuDelta / sysDelta) * onlineCpus * 100
  return 0
}

function formatNetIO(networks: Record<string, { rx_bytes: number; tx_bytes: number }> | undefined) {
  if (!networks) return '0 B / 0 B'
  let rx = 0, tx = 0
  for (const net of Object.values(networks)) {
    rx += net.rx_bytes || 0
    tx += net.tx_bytes || 0
  }
  return `${formatBytes(rx)} / ${formatBytes(tx)}`
}

function formatBlockIO(blkio: Record<string, unknown> | undefined) {
  if (!blkio) return '0 B / 0 B'
  const entries = (blkio.io_service_bytes_recursive as Array<{ op: string; value: number }>) || []
  let read = 0, write = 0
  for (const e of entries) {
    if (e.op === 'read' || e.op === 'Read') read += e.value || 0
    if (e.op === 'write' || e.op === 'Write') write += e.value || 0
  }
  return `${formatBytes(read)} / ${formatBytes(write)}`
}

function extractPorts(c: Record<string, unknown>): string {
  const ports = c.Ports as Array<{ PrivatePort: number; PublicPort?: number; Type: string }> | undefined
  if (!ports || ports.length === 0) return ''
  return ports
    .filter((p) => p.PublicPort)
    .map((p) => `${p.PublicPort}→${p.PrivatePort}/${p.Type}`)
    .join(', ')
}

export async function GET() {
  // System info (always available)
  const totalMem = os.totalmem()
  const freeMem = os.freemem()
  const usedMem = totalMem - freeMem

  const server: ServerInfo = {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model || 'Unknown',
    totalMemory: formatBytes(totalMem),
    freeMemory: formatBytes(freeMem),
    usedMemory: formatBytes(usedMem),
    memoryPercent: Math.round((usedMem / totalMem) * 100),
    uptime: formatUptime(os.uptime()),
    loadAvg: os.loadavg().map((l) => Math.round(l * 100) / 100),
  }

  try {
    // List containers via Docker API
    const listRaw = await dockerRequest('/containers/json')
    const containerList = JSON.parse(listRaw) as Array<Record<string, unknown>>

    // Get stats for each container
    const containers: ContainerStat[] = await Promise.all(
      containerList.map(async (c) => {
        const id = c.Id as string
        const names = c.Names as string[]
        const name = (names?.[0] || '').replace(/^\//, '')
        const state = c.State as string
        const statusText = c.Status as string
        const image = c.Image as string

        let cpu = '0.00%'
        let memUsage = '0 B'
        let memLimit = '0 B'
        let memPercent = '0.00%'
        let netIO = '0 B / 0 B'
        let blockIO = '0 B / 0 B'
        let pids = '0'

        try {
          const statsRaw = await dockerRequest(`/containers/${id}/stats?stream=false`)
          const stats = JSON.parse(statsRaw) as Record<string, unknown>

          const cpuVal = computeCpu(stats)
          cpu = `${cpuVal.toFixed(2)}%`

          const memStats = stats.memory_stats as Record<string, number> | undefined
          if (memStats) {
            const usage = memStats.usage || 0
            const limit = memStats.limit || 0
            const cache = ((memStats as Record<string, unknown>).stats as Record<string, number>)?.cache || 0
            const actualUsage = usage - cache
            memUsage = formatBytes(actualUsage > 0 ? actualUsage : usage)
            memLimit = formatBytes(limit)
            memPercent = limit > 0 ? `${((actualUsage > 0 ? actualUsage : usage) / limit * 100).toFixed(2)}%` : '0%'
          }

          netIO = formatNetIO(stats.networks as Record<string, { rx_bytes: number; tx_bytes: number }> | undefined)
          blockIO = formatBlockIO(stats.blkio_stats as Record<string, unknown> | undefined)

          const pidStats = stats.pids_stats as Record<string, number> | undefined
          pids = String(pidStats?.current || 0)
        } catch {
          // Stats unavailable for this container
        }

        return {
          id,
          name,
          cpu,
          memUsage,
          memLimit,
          memPercent,
          netIO,
          blockIO,
          pids,
          status: statusText || state || 'unknown',
          ports: extractPorts(c),
          image,
        }
      })
    )

    return NextResponse.json({ containers, server })
  } catch {
    // Docker socket not available — return server info only
    return NextResponse.json({ containers: [], server })
  }
}
