import { getTools, getWorkspaceOptions } from '@/app/actions/tools'
import { ToolsClient } from '@/components/tools/tools-client'

export const dynamic = 'force-dynamic'

export default async function ToolsPage() {
  const [tools, workspaces] = await Promise.all([
    getTools(),
    getWorkspaceOptions(),
  ])

  return <ToolsClient initialTools={tools} workspaces={workspaces} />
}
