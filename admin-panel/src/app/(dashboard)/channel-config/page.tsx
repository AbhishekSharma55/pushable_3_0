import { getPlatformBotConfigs } from '@/app/actions/platform-bots'
import { PlatformBotsClient } from '@/components/platform-bots/platform-bots-client'

export const dynamic = 'force-dynamic'

export default async function PlatformBotsPage() {
  const configs = await getPlatformBotConfigs()

  return <PlatformBotsClient configs={configs} />
}
