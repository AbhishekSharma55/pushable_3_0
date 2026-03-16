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
    resourceType: 'tool' | 'kb' | 'skill';
    resourceId: string;
    allowed: boolean;
    createdAt: string;
}
