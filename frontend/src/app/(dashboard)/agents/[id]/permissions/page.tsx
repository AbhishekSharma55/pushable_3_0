'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
    ArrowLeft,
    Bot,
    Wrench,
    BookOpen,
    Zap,
    Loader2,
    Globe,
    Users,
    Cpu,
    Plug,
    ShieldAlert,
    AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useActiveWorkspace } from '@/hooks/use-active-workspace';
import { getAgents, updateSystemPermissions } from '@/lib/api/agents';
import { getTools } from '@/lib/api/tools';
import { getKBs } from '@/lib/api/kb';
import { getSkills } from '@/lib/api/skills';
import { getAgentPermissions, setAgentPermissions } from '@/lib/api/permissions';
import { getIntegrations, getAgentIntegrations, assignToAgent, removeFromAgent } from '@/lib/api/integrations';
import type { Agent, Tool, KnowledgeBase, Skill, AgentPermission, Integration, SystemPermissionsInput } from '@/types';

const SYSTEM_PERMISSION_ITEMS: {
    key: keyof Omit<SystemPermissionsInput, 'systemLevelAccess'>;
    label: string;
    description: string;
    extraWarning?: string;
}[] = [
    {
        key: 'canManageKB',
        label: 'Manage Knowledge Bases',
        description: 'Can create, edit, delete KBs and documents',
    },
    {
        key: 'canManageSkills',
        label: 'Manage Skills',
        description: 'Can create, edit, delete skills',
    },
    {
        key: 'canManageTools',
        label: 'Manage Tools',
        description: 'Can create, edit, delete function tools',
    },
    {
        key: 'canManageSchedules',
        label: 'Manage Schedules',
        description: 'Can create, pause, delete schedules',
    },
    {
        key: 'canManageChannels',
        label: 'Manage Channels',
        description: 'Can view and disconnect channel connections',
    },
    {
        key: 'canManageAgents',
        label: 'Manage Agents',
        description: 'Can create and update agents in this workspace',
        extraWarning: 'This includes creating agents with system access',
    },
];

export default function AgentPermissionsPage() {
    const params = useParams();
    const router = useRouter();
    const workspace = useActiveWorkspace();
    const agentId = params.id as string;

    const [agent, setAgent] = useState<Agent | null>(null);
    const [otherAgents, setOtherAgents] = useState<Agent[]>([]);
    const [tools, setTools] = useState<Tool[]>([]);
    const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
    const [skillsList, setSkillsList] = useState<Skill[]>([]);
    const [permissions, setPermissions] = useState<AgentPermission[]>([]);
    const [allIntegrations, setAllIntegrations] = useState<Integration[]>([]);
    const [agentIntegrationIds, setAgentIntegrationIds] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);
    const [savingIds, setSavingIds] = useState<Set<string>>(new Set());

    // System permissions state
    const [systemPerms, setSystemPerms] = useState<SystemPermissionsInput>({
        systemLevelAccess: false,
        canManageKB: false,
        canManageSkills: false,
        canManageTools: false,
        canManageSchedules: false,
        canManageChannels: false,
        canManageAgents: false,
        canManageBucket: false,
        canExecutePython: false,
    });
    const [savingSystem, setSavingSystem] = useState(false);
    const [showEnableConfirm, setShowEnableConfirm] = useState(false);

    const fetchData = useCallback(async () => {
        if (!workspace) return;
        try {
            setLoading(true);
            const [agentsList, toolsList, kbsList, skillsData, permsList, integrationsData, agentInts] = await Promise.all([
                getAgents(workspace.id),
                getTools(workspace.id),
                getKBs(workspace.id),
                getSkills(workspace.id),
                getAgentPermissions(workspace.id, agentId),
                getIntegrations(workspace.id),
                getAgentIntegrations(workspace.id, agentId),
            ]);
            const currentAgent = agentsList.find((a: Agent) => a.id === agentId) || null;
            setAgent(currentAgent);
            setOtherAgents(agentsList.filter((a: Agent) => a.id !== agentId));
            setTools(toolsList);
            setKbs(kbsList);
            setSkillsList(skillsData);
            setPermissions(permsList);
            setAllIntegrations(integrationsData.filter((i: Integration) => i.status === 'active'));
            setAgentIntegrationIds(new Set(agentInts.map((i: Integration) => i.id)));

            // Initialize system permissions from agent
            if (currentAgent) {
                setSystemPerms({
                    systemLevelAccess: currentAgent.systemLevelAccess,
                    canManageKB: currentAgent.canManageKB,
                    canManageSkills: currentAgent.canManageSkills,
                    canManageTools: currentAgent.canManageTools,
                    canManageSchedules: currentAgent.canManageSchedules,
                    canManageChannels: currentAgent.canManageChannels,
                    canManageAgents: currentAgent.canManageAgents,
                    canManageBucket: currentAgent.canManageBucket,
                    canExecutePython: currentAgent.canExecutePython,
                });
            }
        } catch {
            toast.error('Failed to load data');
        } finally {
            setLoading(false);
        }
    }, [workspace, agentId]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const isAllowed = (resourceId: string, resourceType: string) => {
        const perm = permissions.find(
            (p) => p.resourceId === resourceId && p.resourceType === resourceType
        );
        return perm?.allowed ?? false;
    };

    const handleToggle = async (
        resourceId: string,
        resourceType: 'tool' | 'kb' | 'skill' | 'agent',
        allowed: boolean
    ) => {
        if (!workspace) return;

        const prevPermissions = [...permissions];
        setPermissions((prev) => {
            const existing = prev.find(
                (p) => p.resourceId === resourceId && p.resourceType === resourceType
            );
            if (existing) {
                return prev.map((p) =>
                    p.resourceId === resourceId && p.resourceType === resourceType
                        ? { ...p, allowed }
                        : p
                );
            }
            return [
                ...prev,
                {
                    id: `temp-${resourceId}`,
                    workspaceId: workspace.id,
                    agentId,
                    resourceType,
                    resourceId,
                    allowed,
                    createdAt: new Date().toISOString(),
                },
            ];
        });

        const key = `${resourceType}-${resourceId}`;
        setSavingIds((prev) => new Set(prev).add(key));

        try {
            await setAgentPermissions(workspace.id, agentId, [
                { resourceType, resourceId, allowed },
            ]);
        } catch {
            setPermissions(prevPermissions);
            toast.error('Failed to update permission');
        } finally {
            setSavingIds((prev) => {
                const next = new Set(prev);
                next.delete(key);
                return next;
            });
        }
    };

    const handleIntegrationToggle = async (integrationId: string, enabled: boolean) => {
        if (!workspace) return;
        const key = `integration-${integrationId}`;
        const prev = new Set(agentIntegrationIds);

        // Optimistic
        setAgentIntegrationIds(s => {
            const next = new Set(s);
            if (enabled) next.add(integrationId);
            else next.delete(integrationId);
            return next;
        });
        setSavingIds(p => new Set(p).add(key));

        try {
            if (enabled) await assignToAgent(workspace.id, agentId, integrationId);
            else await removeFromAgent(workspace.id, agentId, integrationId);
        } catch {
            setAgentIntegrationIds(prev);
            toast.error('Failed to update integration');
        } finally {
            setSavingIds(p => { const n = new Set(p); n.delete(key); return n; });
        }
    };

    const handleSystemAccessToggle = (enabled: boolean) => {
        if (enabled) {
            setShowEnableConfirm(true);
        } else {
            setSystemPerms(prev => ({
                ...prev,
                systemLevelAccess: false,
                canManageKB: false,
                canManageSkills: false,
                canManageTools: false,
                canManageSchedules: false,
                canManageChannels: false,
                canManageAgents: false,
            }));
        }
    };

    const confirmEnableSystemAccess = () => {
        setSystemPerms(prev => ({ ...prev, systemLevelAccess: true }));
        setShowEnableConfirm(false);
    };

    const handleSystemPermToggle = (key: keyof Omit<SystemPermissionsInput, 'systemLevelAccess'>, enabled: boolean) => {
        setSystemPerms(prev => ({ ...prev, [key]: enabled }));
    };

    const saveSystemPermissions = async () => {
        if (!workspace) return;
        setSavingSystem(true);
        try {
            await updateSystemPermissions(workspace.id, agentId, systemPerms);
            toast.success('System permissions saved');
        } catch {
            toast.error('Failed to save system permissions');
        } finally {
            setSavingSystem(false);
        }
    };

    const typeBadge = (type: string) => {
        if (type === 'function')
            return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
        return 'bg-purple-500/10 text-purple-600 border-purple-500/20';
    };

    if (loading) {
        return (
            <div className="flex h-[calc(100vh-120px)] items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => router.push('/agents')}
                >
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/20 to-blue-500/20">
                    <Bot className="h-5 w-5 text-violet-600" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">
                        {agent?.name || 'Agent'} — Permissions
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        Control which resources this agent can access
                    </p>
                </div>
            </div>

            {/* Tabs */}
            <Tabs defaultValue="permissions">
                <TabsList>
                    <TabsTrigger
                        value="chat"
                        onClick={() => router.push(`/agents?agent=${agentId}`)}
                    >
                        Chat
                    </TabsTrigger>
                    <TabsTrigger value="permissions">Permissions</TabsTrigger>
                </TabsList>

                <TabsContent value="permissions" className="mt-6 space-y-8">
                    {/* Tools Section */}
                    <div>
                        <div className="flex items-center gap-2 mb-4">
                            <Wrench className="h-4 w-4 text-blue-600" />
                            <h2 className="text-lg font-semibold">Tools</h2>
                        </div>

                        {tools.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-border/60 p-8 text-center">
                                <p className="text-sm text-muted-foreground">
                                    No tools configured yet. Create tools first to assign them.
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {tools.map((tool) => {
                                    const key = `tool-${tool.id}`;
                                    return (
                                        <div
                                            key={tool.id}
                                            className="flex items-center justify-between rounded-lg border border-border/60 bg-card px-4 py-3"
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500/15 to-cyan-500/15 flex-shrink-0">
                                                    <Wrench className="h-4 w-4 text-blue-600" />
                                                </div>
                                                <div>
                                                    <p className="text-sm font-medium">{tool.name}</p>
                                                    <div className="flex items-center gap-1.5 mt-0.5">
                                                        <Badge
                                                            variant="outline"
                                                            className={`text-[10px] px-1.5 py-0 ${typeBadge(tool.type)}`}
                                                        >
                                                            {tool.type}
                                                        </Badge>
                                                        {tool.isGlobal && (
                                                            <Badge
                                                                variant="outline"
                                                                className="text-[10px] px-1.5 py-0 bg-amber-500/10 text-amber-600 border-amber-500/20"
                                                            >
                                                                <Globe className="h-2.5 w-2.5 mr-0.5" />
                                                                global
                                                            </Badge>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {savingIds.has(key) && (
                                                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                                                )}
                                                <Switch
                                                    checked={isAllowed(tool.id, 'tool')}
                                                    onCheckedChange={(checked) =>
                                                        handleToggle(tool.id, 'tool', checked)
                                                    }
                                                    disabled={savingIds.has(key)}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Knowledge Bases Section */}
                    <div>
                        <div className="flex items-center gap-2 mb-4">
                            <BookOpen className="h-4 w-4 text-emerald-600" />
                            <h2 className="text-lg font-semibold">Knowledge Bases</h2>
                        </div>

                        {kbs.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-border/60 p-8 text-center">
                                <p className="text-sm text-muted-foreground">
                                    No knowledge bases yet. Create a KB and upload documents first.
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {kbs.map((kb) => {
                                    const key = `kb-${kb.id}`;
                                    return (
                                        <div
                                            key={kb.id}
                                            className="flex items-center justify-between rounded-lg border border-border/60 bg-card px-4 py-3"
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500/15 to-teal-500/15 flex-shrink-0">
                                                    <BookOpen className="h-4 w-4 text-emerald-600" />
                                                </div>
                                                <div>
                                                    <p className="text-sm font-medium">{kb.name}</p>
                                                    {kb.description && (
                                                        <p className="text-xs text-muted-foreground truncate max-w-[300px] mt-0.5">
                                                            {kb.description}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {savingIds.has(key) && (
                                                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                                                )}
                                                <Switch
                                                    checked={isAllowed(kb.id, 'kb')}
                                                    onCheckedChange={(checked) =>
                                                        handleToggle(kb.id, 'kb', checked)
                                                    }
                                                    disabled={savingIds.has(key)}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Skills Section */}
                    <div>
                        <div className="flex items-center gap-2 mb-4">
                            <Zap className="h-4 w-4 text-amber-600" />
                            <h2 className="text-lg font-semibold">Skills</h2>
                        </div>

                        {skillsList.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-border/60 p-8 text-center">
                                <p className="text-sm text-muted-foreground">
                                    No skills yet. Create skills to assign them to agents.
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {skillsList.map((skill) => {
                                    const key = `skill-${skill.id}`;
                                    return (
                                        <div
                                            key={skill.id}
                                            className="flex items-center justify-between rounded-lg border border-border/60 bg-card px-4 py-3"
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500/15 to-orange-500/15 flex-shrink-0">
                                                    <Zap className="h-4 w-4 text-amber-600" />
                                                </div>
                                                <div>
                                                    <p className="text-sm font-medium">{skill.name}</p>
                                                    <p className="text-xs text-muted-foreground truncate max-w-[300px] mt-0.5">
                                                        {skill.instructions.slice(0, 60)}
                                                        {skill.instructions.length > 60 ? '...' : ''}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {savingIds.has(key) && (
                                                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                                                )}
                                                <Switch
                                                    checked={isAllowed(skill.id, 'skill')}
                                                    onCheckedChange={(checked) =>
                                                        handleToggle(skill.id, 'skill', checked)
                                                    }
                                                    disabled={savingIds.has(key)}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Agent Delegation Section */}
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <Users className="h-4 w-4 text-violet-600" />
                            <h2 className="text-lg font-semibold">Agent Delegation</h2>
                        </div>
                        <p className="text-xs text-muted-foreground mb-4">
                            Allow this agent to call other agents as tools during a run.
                        </p>

                        {otherAgents.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-border/60 p-8 text-center">
                                <p className="text-sm text-muted-foreground">
                                    No other agents in this workspace. Create more agents to enable delegation.
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {otherAgents.map((a) => {
                                    const key = `agent-${a.id}`;
                                    return (
                                        <div
                                            key={a.id}
                                            className="flex items-center justify-between rounded-lg border border-border/60 bg-card px-4 py-3"
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500/15 to-blue-500/15 flex-shrink-0">
                                                    <Bot className="h-4 w-4 text-violet-600" />
                                                </div>
                                                <div>
                                                    <p className="text-sm font-medium">{a.name}</p>
                                                    <Badge
                                                        variant="outline"
                                                        className="text-[10px] px-1.5 py-0 mt-0.5 bg-muted/50"
                                                    >
                                                        <Cpu className="h-2.5 w-2.5 mr-0.5" />
                                                        {a.model}
                                                    </Badge>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {savingIds.has(key) && (
                                                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                                                )}
                                                <Switch
                                                    checked={isAllowed(a.id, 'agent')}
                                                    onCheckedChange={(checked) =>
                                                        handleToggle(a.id, 'agent', checked)
                                                    }
                                                    disabled={savingIds.has(key)}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Integrations Section */}
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <Plug className="h-4 w-4 text-cyan-600" />
                            <h2 className="text-lg font-semibold">Integrations</h2>
                        </div>
                        <p className="text-xs text-muted-foreground mb-4">
                            Assign connected app integrations (GitHub, Gmail, Slack, etc.) to this agent.
                        </p>

                        {allIntegrations.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-border/60 p-8 text-center">
                                <p className="text-sm text-muted-foreground">
                                    No active integrations.{' '}
                                    <a href="/integrations" className="text-primary underline">
                                        Connect apps
                                    </a>{' '}
                                    to assign them to agents.
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {allIntegrations.map((integ) => {
                                    const key = `integration-${integ.id}`;
                                    const displayLabel = integ.connectionLabel || integ.name;
                                    return (
                                        <div key={integ.id} className="flex items-center justify-between rounded-lg border border-border/60 bg-card px-4 py-3">
                                            <div className="flex items-center gap-3">
                                                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500/15 to-blue-500/15 flex-shrink-0">
                                                    <Plug className="h-4 w-4 text-cyan-600" />
                                                </div>
                                                <div>
                                                    <p className="text-sm font-medium">
                                                        {displayLabel}
                                                        <span className="text-muted-foreground font-normal ml-1.5">
                                                            ({integ.composioToolkitSlug})
                                                        </span>
                                                    </p>
                                                    {integ.connectionDescription && (
                                                        <p className="text-xs text-muted-foreground truncate max-w-[300px] mt-0.5">
                                                            {integ.connectionDescription}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {savingIds.has(key) && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                                                <Switch
                                                    checked={agentIntegrationIds.has(integ.id)}
                                                    onCheckedChange={(checked) => handleIntegrationToggle(integ.id, checked)}
                                                    disabled={savingIds.has(key)}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* System Access Section */}
                    <div className="rounded-xl border-2 border-red-500/30 bg-red-500/5 p-6 space-y-5">
                        <div className="flex items-center gap-2 mb-1">
                            <ShieldAlert className="h-5 w-5 text-red-500" />
                            <h2 className="text-lg font-semibold text-red-600">System-Level Access</h2>
                        </div>

                        {/* Warning Banner */}
                        <div className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
                            <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                            <div className="text-sm text-amber-800 dark:text-amber-300">
                                <p className="font-medium mb-1">Warning</p>
                                <p>
                                    Enabling this allows the agent to create, edit, and delete
                                    workspace resources including KBs, Skills, Tools, Schedules,
                                    and other Agents. Only enable this for trusted, well-configured
                                    agents. Unexpected behavior may result.
                                </p>
                            </div>
                        </div>

                        {/* Master Toggle */}
                        <div className="flex items-center justify-between rounded-lg border border-border/60 bg-card px-4 py-3">
                            <div>
                                <p className="text-sm font-medium">Enable System Access</p>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    Master toggle for all system-level permissions
                                </p>
                            </div>
                            <Switch
                                checked={systemPerms.systemLevelAccess}
                                onCheckedChange={handleSystemAccessToggle}
                            />
                        </div>

                        {/* Confirmation Dialog */}
                        {showEnableConfirm && (
                            <div className="rounded-lg border border-red-500/30 bg-card p-4 space-y-3">
                                <p className="text-sm font-medium text-red-600">
                                    Are you sure? This agent will be able to modify your workspace.
                                </p>
                                <div className="flex gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setShowEnableConfirm(false)}
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        variant="destructive"
                                        size="sm"
                                        onClick={confirmEnableSystemAccess}
                                    >
                                        Yes, Enable System Access
                                    </Button>
                                </div>
                            </div>
                        )}

                        {/* Individual Permission Toggles */}
                        {systemPerms.systemLevelAccess && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {SYSTEM_PERMISSION_ITEMS.map((item) => (
                                    <div
                                        key={item.key}
                                        className="flex items-start justify-between rounded-lg border border-border/60 bg-card px-4 py-3"
                                    >
                                        <div className="pr-3">
                                            <p className="text-sm font-medium">{item.label}</p>
                                            <p className="text-xs text-muted-foreground mt-0.5">
                                                {item.description}
                                            </p>
                                            {item.extraWarning && (
                                                <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                                                    <AlertTriangle className="h-3 w-3" />
                                                    {item.extraWarning}
                                                </p>
                                            )}
                                        </div>
                                        <Switch
                                            checked={systemPerms[item.key]}
                                            onCheckedChange={(checked) =>
                                                handleSystemPermToggle(item.key, checked)
                                            }
                                        />
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Save Button */}
                        <div className="flex justify-end pt-2">
                            <Button
                                onClick={saveSystemPermissions}
                                disabled={savingSystem}
                            >
                                {savingSystem && (
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                )}
                                Save System Permissions
                            </Button>
                        </div>
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    );
}
