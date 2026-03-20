import { getTools, getWorkspaceOptions } from '@/app/actions/tools'
import { ToolsClient } from '@/components/tools/tools-client'

export default async function ToolsPage() {
  const [tools, workspaces] = await Promise.all([
    getTools(),
    getWorkspaceOptions(),
  ])

  return <ToolsClient initialTools={tools} workspaces={workspaces} />
}
