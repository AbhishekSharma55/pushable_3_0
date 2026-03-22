import {
  getLLMModels, getEnvConfig,
  getBrowserProxies, getBrowserProfiles, getBrowserSessions,
  getAgentDefaults, getIntegrationSummary,
  getSystemSettings, getWorkspaceList,
} from '@/app/actions/configuration'
import { ConfigurationClient } from '@/components/configuration/configuration-client'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const [models, envConfig, proxies, profiles, sessions, agentDefaults, integrations, systemSettings, workspaces] = await Promise.all([
    getLLMModels(),
    getEnvConfig(),
    getBrowserProxies(),
    getBrowserProfiles(),
    getBrowserSessions(),
    getAgentDefaults(),
    getIntegrationSummary(),
    getSystemSettings(),
    getWorkspaceList(),
  ])

  return (
    <ConfigurationClient
      models={models}
      envConfig={envConfig}
      proxies={proxies}
      profiles={profiles}
      sessions={sessions}
      agentDefaults={agentDefaults}
      integrations={integrations}
      systemSettings={systemSettings}
      workspaces={workspaces}
    />
  )
}
