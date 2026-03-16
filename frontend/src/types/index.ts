export interface User {
    id: string;
    name: string;
    email: string;
}

export interface Workspace {
    id: string;
    name: string;
    slug: string;
    ownerId: string;
    createdAt: string;
    updatedAt: string;
}

export interface WorkspaceMember {
    id: string;
    workspaceId: string;
    userId: string;
    role: 'owner' | 'admin' | 'member';
}

export interface Agent {
    id: string;
    workspaceId: string;
    name: string;
    systemPrompt: string | null;
    model: string;
    temperature: number;
    createdAt: string;
    updatedAt: string;
}

export interface Session {
    id: string;
    workspaceId: string;
    agentId: string;
    title: string;
    createdAt: string;
}

export interface Message {
    id: string;
    sessionId: string;
    role: 'user' | 'assistant' | 'tool';
    content: string;
    tokenCount: number;
    createdAt: string;
}

export interface Tool {
    id: string;
    workspaceId: string | null;
    name: string;
    description: string | null;
    type: 'mcp' | 'function';
    config: Record<string, unknown>;
    isGlobal: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface AgentPermission {
    id: string;
    workspaceId: string;
    agentId: string;
    resourceType: 'tool' | 'kb' | 'skill' | 'agent';
    resourceId: string;
    allowed: boolean;
    createdAt: string;
}

export interface KnowledgeBase {
    id: string;
    workspaceId: string;
    name: string;
    description: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface KBDocument {
    id: string;
    workspaceId: string;
    kbId: string;
    filename: string;
    chunkCount: number;
    createdAt: string;
}

export interface Skill {
    id: string;
    workspaceId: string;
    name: string;
    description: string | null;
    origin: string | null;
    instructions: string;
    createdAt: string;
    updatedAt: string;
}

export interface Task {
    id: string;
    workspaceId: string;
    agentId: string;
    title: string;
    description: string | null;
    status: 'pending' | 'running' | 'done' | 'failed';
    result: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface Workflow {
    id: string;
    workspaceId: string;
    name: string;
    createdAt: string;
    updatedAt: string;
    steps?: WorkflowStep[];
}

export interface WorkflowStep {
    id: string;
    workspaceId: string;
    workflowId: string;
    taskId: string;
    order: number;
    createdAt: string;
}

export interface Integration {
    id: string;
    workspaceId: string;
    composioToolkitSlug: string;
    composioConnectionId: string;
    name: string;
    status: 'active' | 'inactive' | 'pending' | 'failed';
    metadata: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
}

export interface Toolkit {
    slug: string;
    name: string;
    description: string;
    logo: string;
    isConnected: boolean;
}

export interface Schedule {
    id: string;
    workspaceId: string;
    name: string;
    cron: string;
    targetType: 'task' | 'workflow';
    targetId: string;
    enabled: boolean;
    lastRunAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface BrowserProfile {
    id: string;
    workspaceId: string;
    name: string;
    profilePath: string;
    assignedAgentId: string | null;
    os: string;
    status: 'active' | 'inactive';
    metadata: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
}

export interface BrowserSession {
    id: string;
    workspaceId: string;
    profileId: string;
    agentId: string | null;
    taskId: string | null;
    status: 'starting' | 'active' | 'closed' | 'error';
    createdAt: string;
    closedAt: string | null;
}
