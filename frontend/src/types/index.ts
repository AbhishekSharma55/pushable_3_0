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
    emoji: string | null;
    systemPrompt: string | null;
    model: string;
    temperature: number;
    systemLevelAccess: boolean;
    canManageKB: boolean;
    canManageSkills: boolean;
    canManageTools: boolean;
    canManageSchedules: boolean;
    canManageChannels: boolean;
    canManageAgents: boolean;
    canManageBucket: boolean;
    canExecutePython: boolean;
    bucketFolder: string | null;
    requireApprovalForAll: boolean;
    browserType: 'cloud' | 'extension';
    browserEnabled: boolean;
    browserProxyId: string | null;
    isCeo: boolean;
    isTester: boolean;
    agentType: 'ceo' | 'worker' | 'tester';
    createdAt: string;
    updatedAt: string;
}

export interface SystemPermissionsInput {
    systemLevelAccess: boolean;
    canManageKB: boolean;
    canManageSkills: boolean;
    canManageTools: boolean;
    canManageSchedules: boolean;
    canManageChannels: boolean;
    canManageAgents: boolean;
    canManageBucket: boolean;
    canExecutePython: boolean;
}

export interface Session {
    id: string;
    workspaceId: string;
    agentId: string;
    title: string;
    createdAt: string;
    updatedAt?: string;
}

export interface Run {
    id: string;
    sessionId: string;
    workspaceId: string;
    status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'interrupted' | 'cancelled';
    error: string | null;
    metadata: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
}

export interface Message {
    id: string;
    sessionId: string;
    role: 'user' | 'assistant' | 'tool';
    content: string;
    tokenCount: number;
    createdAt: string;
    metadata?: Record<string, unknown>;
}

export interface BucketFile {
    id: string;
    workspaceId: string;
    filename: string;
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
    folder: string;
    source: 'chat_upload' | 'agent_generated' | 'api_upload';
    sessionId: string | null;
    agentId: string | null;
    uploadedBy: string | null;
    metadata: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
}

export interface Tool {
    id: string;
    workspaceId: string | null;
    name: string;
    description: string | null;
    type: 'mcp' | 'function';
    config: Record<string, unknown>;
    isGlobal: boolean;
    requiresApproval: boolean;
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

export interface KBChunk {
    id: string;
    workspaceId: string;
    kbId: string;
    documentId: string;
    content: string;
    metadata: Record<string, unknown>;
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

export interface Integration {
    id: string;
    workspaceId: string;
    composioToolkitSlug: string;
    composioConnectionId: string;
    name: string;
    connectionLabel: string;
    connectionDescription: string | null;
    connectionIcon: string | null;
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
    agentId: string;
    name: string;
    prompt: string;
    cron: string;
    enabled: boolean;
    lastRunAt: string | null;
    createdAt: string;
    updatedAt: string;
    naturalLanguage: string | null;
    humanizeDelay: number;
    timezone: string;
    businessHoursOnly: boolean;
    workStartHour: number;
    workEndHour: number;
    workDays: number[];
    scheduleType: 'natural' | 'preset' | 'custom';
    presetKey: string | null;
    nextRunDescription: string | null;
}

export interface SchedulePreset {
    key: string;
    label: string;
    description: string;
    cron: string | null;
    humanizeDelay: number;
    icon: string;
}

export interface ScheduleRun {
    id: string;
    scheduleId: string;
    workspaceId: string;
    status: 'running' | 'completed' | 'failed' | 'skipped';
    resultText: string | null;
    error: string | null;
    creditsUsed: number;
    durationMs: number | null;
    startedAt: string;
    completedAt: string | null;
}

export interface ScheduleStats {
    totalRuns: number;
    totalCredits: number;
    successCount: number;
    failCount: number;
    avgDurationMs: number;
}

export interface ChannelConnection {
    id: string;
    workspaceId: string;
    agentId: string;
    channelType: 'telegram' | 'slack';
    name: string;
    status: 'active' | 'inactive' | 'error';
    config: Record<string, unknown>;
    errorMessage: string | null;
    lastMessageAt: string | null;
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

export interface LLMModel {
    id: string;
    provider: string;
    modelId: string;
    displayName: string;
    description: string | null;
    multiplier: number;
    contextWindow: number | null;
    minimumPlan: 'free' | 'starter' | 'pro' | 'scale';
    isFeatured: boolean;
    available: boolean;
    requiredPlan: string;
    directApiEnabled?: boolean;
    creditCostPerMessage: number;
}

export interface CreditBalance {
    planCredits: number;
    topupCredits: number;
    availableCredits: number;
    overageEnabled: boolean;
    overageLimit: number;
    totalConsumed: number;
}

export interface LedgerEntry {
    id: string;
    amount: number;
    type: string;
    creditsAfter: number;
    metadata: Record<string, unknown>;
    createdAt: string;
}

export interface BrowserSession {
    id: string;
    workspaceId: string;
    profileId: string;
    agentId: string | null;
    status: 'starting' | 'active' | 'closed' | 'error';
    createdAt: string;
    closedAt: string | null;
}

// --- Projects ---

export interface Project {
    id: string;
    workspaceId: string;
    name: string;
    description: string | null;
    instructions: string | null;
    status: 'active' | 'paused' | 'completed' | 'archived';
    createdBy: string | null;
    createdAt: string;
    updatedAt: string;
    milestones?: ProjectMilestone[];
    agents?: ProjectAgent[];
    knowledgeBases?: ProjectKB[];
}

export interface ProjectMilestone {
    id: string;
    projectId: string;
    workspaceId: string;
    title: string;
    description: string | null;
    status: 'not_started' | 'in_progress' | 'completed' | 'blocked';
    targetDate: string | null;
    completedAt: string | null;
    evaluationNotes: string | null;
    sortOrder: number;
    createdAt: string;
    updatedAt: string;
}

export interface ProjectAgent {
    id: string;
    projectId: string;
    agentId: string;
    roleInProject: string | null;
    assignedAt: string;
    agent?: {
        id: string;
        name: string;
        model: string;
        isCeo: boolean;
        agentType: string;
    };
}

export interface ProjectKB {
    id: string;
    projectId: string;
    kbId: string;
    assignedAt: string;
    knowledgeBase?: {
        id: string;
        name: string;
        description: string | null;
    };
}

export interface RunReport {
    id: string;
    workspaceId: string;
    agentId: string;
    projectId: string | null;
    sessionId: string | null;
    scheduleId: string | null;
    summary: string;
    actionsTaken: string | null;
    outcomes: string | null;
    issues: string | null;
    metrics: Record<string, unknown>;
    data: Record<string, unknown>;
    runType: 'scheduled' | 'on_demand' | 'ceo_triggered';
    startedAt: string;
    completedAt: string | null;
    createdAt: string;
    agent?: { id: string; name: string };
}

// --- Testing ---

export interface TestSuite {
    id: string;
    workspaceId: string;
    agentId: string;
    name: string;
    description: string | null;
    status: 'draft' | 'running' | 'completed';
    createdBy: string | null;
    createdAt: string;
    updatedAt: string;
    agent?: { id: string; name: string; emoji: string | null };
    cases?: TestCase[];
    stats?: TestStats;
}

export interface TestCase {
    id: string;
    suiteId: string;
    workspaceId: string;
    title: string;
    input: string;
    expectedBehavior: string;
    actualResponse: string | null;
    status: 'pending' | 'passed' | 'failed' | 'error';
    evaluationNotes: string | null;
    executionTimeMs: number | null;
    createdAt: string;
    executedAt: string | null;
}

export interface TestStats {
    total: number;
    passed: number;
    failed: number;
    pending: number;
    error: number;
}

export interface BrowserProxy {
    id: string;
    workspaceId: string;
    label: string;
    host: string;
    port: number;
    protocol: 'http' | 'https' | 'socks5';
    country: string | null;
    city: string | null;
    isActive: boolean;
    lastTestedAt: string | null;
    lastTestStatus: 'success' | 'failed' | 'untested';
    createdAt: string;
    updatedAt: string;
}
