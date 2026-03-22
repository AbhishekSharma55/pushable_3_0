import {
  getPlatformStats,
  getWorkspaceResources,
  getRecentCreditLogs,
  getRecentLedgerEntries,
  getRecentRuns,
  getRecentScheduleRuns,
  getModelUsage,
  getCreditsByType,
} from '@/app/actions/monitoring'
import { MonitoringClient } from '@/components/monitoring/monitoring-client'

export const dynamic = 'force-dynamic'

export default async function MonitoringPage() {
  const [
    stats,
    workspaces,
    creditLogs,
    ledgerEntries,
    runs,
    scheduleRuns,
    modelUsage,
    creditsByType,
  ] = await Promise.all([
    getPlatformStats(),
    getWorkspaceResources(),
    getRecentCreditLogs(),
    getRecentLedgerEntries(),
    getRecentRuns(),
    getRecentScheduleRuns(),
    getModelUsage(),
    getCreditsByType(),
  ])

  return (
    <MonitoringClient
      stats={stats}
      workspaces={workspaces}
      creditLogs={creditLogs}
      ledgerEntries={ledgerEntries}
      runs={runs}
      scheduleRuns={scheduleRuns}
      modelUsage={modelUsage}
      creditsByType={creditsByType}
    />
  )
}
