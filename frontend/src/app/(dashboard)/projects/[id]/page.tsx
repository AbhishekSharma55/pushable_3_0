'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
    ArrowLeft,
    Plus,
    Trash2,
    Loader2,
    Bot,
    BookOpen,
    Target,
    FileText,
    Pencil,
    X,
    Check,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useActiveWorkspace } from '@/hooks/use-active-workspace';
import {
    getProject,
    updateProject,
    deleteProject,
    assignAgentToProject,
    removeAgentFromProject,
    createMilestone,
    updateMilestone,
    deleteMilestone,
    assignKBToProject,
    removeKBFromProject,
    getProjectReports,
} from '@/lib/api/projects';
import type { Project, ProjectMilestone, RunReport, Agent, KnowledgeBase } from '@/types';

// Lazy-load workspace agents and KBs for the assign dialogs
import { apiClient } from '@/lib/api/client';

const statusColors: Record<string, string> = {
    active: 'bg-green-500/10 text-green-500 border-green-500/20',
    paused: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    completed: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    archived: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
};

const milestoneStatusColors: Record<string, string> = {
    not_started: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
    in_progress: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    completed: 'bg-green-500/10 text-green-500 border-green-500/20',
    blocked: 'bg-red-500/10 text-red-500 border-red-500/20',
};

export default function ProjectDetailPage() {
    const { id } = useParams<{ id: string }>();
    const workspace = useActiveWorkspace();
    const router = useRouter();

    const [project, setProject] = useState<Project | null>(null);
    const [reports, setReports] = useState<RunReport[]>([]);
    const [loading, setLoading] = useState(true);

    // Edit state
    const [editing, setEditing] = useState(false);
    const [editForm, setEditForm] = useState({ name: '', description: '', instructions: '', status: '' });

    // Dialogs
    const [milestoneDialog, setMilestoneDialog] = useState(false);
    const [milestoneForm, setMilestoneForm] = useState({ title: '', description: '', targetDate: '' });
    const [agentDialog, setAgentDialog] = useState(false);
    const [kbDialog, setKbDialog] = useState(false);
    const [allAgents, setAllAgents] = useState<Agent[]>([]);
    const [allKBs, setAllKBs] = useState<KnowledgeBase[]>([]);
    const [selectedAgentId, setSelectedAgentId] = useState('');
    const [agentRole, setAgentRole] = useState('');
    const [selectedKbId, setSelectedKbId] = useState('');

    const fetchProject = useCallback(async () => {
        if (!workspace || !id) return;
        try {
            setLoading(true);
            const [proj, reps] = await Promise.all([
                getProject(workspace.id, id),
                getProjectReports(workspace.id, id).catch(() => []),
            ]);
            setProject(proj);
            setReports(reps);
            setEditForm({
                name: proj.name,
                description: proj.description || '',
                instructions: proj.instructions || '',
                status: proj.status,
            });
        } catch {
            toast.error('Failed to load project');
        } finally {
            setLoading(false);
        }
    }, [workspace, id]);

    useEffect(() => { fetchProject(); }, [fetchProject]);

    const handleSaveEdit = async () => {
        if (!workspace || !id) return;
        try {
            await updateProject(workspace.id, id, editForm);
            toast.success('Project updated');
            setEditing(false);
            fetchProject();
        } catch {
            toast.error('Failed to update project');
        }
    };

    const handleDelete = async () => {
        if (!workspace || !id) return;
        try {
            await deleteProject(workspace.id, id);
            toast.success('Project deleted');
            router.push('/projects');
        } catch {
            toast.error('Failed to delete project');
        }
    };

    const handleCreateMilestone = async () => {
        if (!workspace || !id || !milestoneForm.title.trim()) return;
        try {
            await createMilestone(workspace.id, id, {
                title: milestoneForm.title.trim(),
                description: milestoneForm.description.trim() || undefined,
                targetDate: milestoneForm.targetDate || undefined,
            });
            toast.success('Milestone created');
            setMilestoneDialog(false);
            setMilestoneForm({ title: '', description: '', targetDate: '' });
            fetchProject();
        } catch {
            toast.error('Failed to create milestone');
        }
    };

    const handleMilestoneStatusChange = async (milestoneId: string, status: string) => {
        if (!workspace || !id) return;
        try {
            await updateMilestone(workspace.id, id, milestoneId, { status });
            fetchProject();
        } catch {
            toast.error('Failed to update milestone');
        }
    };

    const handleDeleteMilestone = async (milestoneId: string) => {
        if (!workspace || !id) return;
        try {
            await deleteMilestone(workspace.id, id, milestoneId);
            toast.success('Milestone deleted');
            fetchProject();
        } catch {
            toast.error('Failed to delete milestone');
        }
    };

    const openAgentDialog = async () => {
        if (!workspace) return;
        try {
            const res = await apiClient.get('/api/agents', { headers: { 'x-workspace-id': workspace.id } });
            setAllAgents(res.data.data);
            setAgentDialog(true);
        } catch {
            toast.error('Failed to load agents');
        }
    };

    const handleAssignAgent = async () => {
        if (!workspace || !id || !selectedAgentId) return;
        try {
            await assignAgentToProject(workspace.id, id, selectedAgentId, agentRole || undefined);
            toast.success('Agent assigned');
            setAgentDialog(false);
            setSelectedAgentId('');
            setAgentRole('');
            fetchProject();
        } catch {
            toast.error('Failed to assign agent');
        }
    };

    const handleRemoveAgent = async (agentId: string) => {
        if (!workspace || !id) return;
        try {
            await removeAgentFromProject(workspace.id, id, agentId);
            toast.success('Agent removed');
            fetchProject();
        } catch {
            toast.error('Failed to remove agent');
        }
    };

    const openKbDialog = async () => {
        if (!workspace) return;
        try {
            const res = await apiClient.get('/api/kb', { headers: { 'x-workspace-id': workspace.id } });
            setAllKBs(res.data.data);
            setKbDialog(true);
        } catch {
            toast.error('Failed to load knowledge bases');
        }
    };

    const handleAssignKB = async () => {
        if (!workspace || !id || !selectedKbId) return;
        try {
            await assignKBToProject(workspace.id, id, selectedKbId);
            toast.success('Knowledge base linked');
            setKbDialog(false);
            setSelectedKbId('');
            fetchProject();
        } catch {
            toast.error('Failed to link knowledge base');
        }
    };

    const handleRemoveKB = async (kbId: string) => {
        if (!workspace || !id) return;
        try {
            await removeKBFromProject(workspace.id, id, kbId);
            toast.success('Knowledge base removed');
            fetchProject();
        } catch {
            toast.error('Failed to remove knowledge base');
        }
    };

    if (loading) {
        return (
            <div className="p-6 max-w-5xl mx-auto space-y-6">
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-40 rounded-xl" />
                <Skeleton className="h-60 rounded-xl" />
            </div>
        );
    }

    if (!project) {
        return (
            <div className="p-6 max-w-5xl mx-auto text-center py-20">
                <p className="text-muted-foreground">Project not found.</p>
                <Button variant="outline" className="mt-4" onClick={() => router.push('/projects')}>
                    Back to Projects
                </Button>
            </div>
        );
    }

    const milestones = project.milestones || [];
    const agents = project.agents || [];
    const kbs = project.knowledgeBases || [];
    const completedMilestones = milestones.filter((m) => m.status === 'completed').length;

    return (
        <div className="p-6 max-w-5xl mx-auto space-y-8">
            {/* Header */}
            <div>
                <button
                    onClick={() => router.push('/projects')}
                    className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-4"
                >
                    <ArrowLeft className="h-3.5 w-3.5" /> Back to Projects
                </button>

                {editing ? (
                    <div className="space-y-4 border rounded-xl p-5">
                        <div>
                            <Label>Name</Label>
                            <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                        </div>
                        <div>
                            <Label>Description</Label>
                            <Input value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
                        </div>
                        <div>
                            <Label>Instructions</Label>
                            <Textarea rows={3} value={editForm.instructions} onChange={(e) => setEditForm({ ...editForm, instructions: e.target.value })} />
                        </div>
                        <div>
                            <Label>Status</Label>
                            <Select value={editForm.status} onValueChange={(v) => setEditForm({ ...editForm, status: v })}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="active">Active</SelectItem>
                                    <SelectItem value="paused">Paused</SelectItem>
                                    <SelectItem value="completed">Completed</SelectItem>
                                    <SelectItem value="archived">Archived</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex gap-2">
                            <Button size="sm" onClick={handleSaveEdit}><Check className="h-3.5 w-3.5 mr-1" /> Save</Button>
                            <Button size="sm" variant="outline" onClick={() => setEditing(false)}><X className="h-3.5 w-3.5 mr-1" /> Cancel</Button>
                        </div>
                    </div>
                ) : (
                    <div className="flex items-start justify-between">
                        <div>
                            <div className="flex items-center gap-3">
                                <h1 className="text-2xl font-bold">{project.name}</h1>
                                <Badge variant="outline" className={statusColors[project.status]}>{project.status}</Badge>
                            </div>
                            {project.description && <p className="text-muted-foreground mt-1">{project.description}</p>}
                            {project.instructions && (
                                <p className="text-sm text-muted-foreground mt-2 border-l-2 pl-3 italic">{project.instructions}</p>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                                <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                            </Button>
                            <Button variant="destructive" size="sm" onClick={handleDelete}>
                                <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            {/* Milestones */}
            <section className="space-y-3">
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                        <Target className="h-5 w-5" />
                        Milestones
                        {milestones.length > 0 && (
                            <span className="text-sm font-normal text-muted-foreground">
                                ({completedMilestones}/{milestones.length})
                            </span>
                        )}
                    </h2>
                    <Button size="sm" variant="outline" onClick={() => setMilestoneDialog(true)}>
                        <Plus className="h-3.5 w-3.5 mr-1" /> Add
                    </Button>
                </div>
                {milestones.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg">No milestones defined yet.</p>
                ) : (
                    <div className="space-y-2">
                        {milestones.map((m) => (
                            <div key={m.id} className="flex items-center justify-between border rounded-lg px-4 py-3">
                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                    <Select value={m.status} onValueChange={(v) => handleMilestoneStatusChange(m.id, v)}>
                                        <SelectTrigger className="w-[130px] h-7 text-xs">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="not_started">Not Started</SelectItem>
                                            <SelectItem value="in_progress">In Progress</SelectItem>
                                            <SelectItem value="completed">Completed</SelectItem>
                                            <SelectItem value="blocked">Blocked</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <div className="min-w-0">
                                        <span className="font-medium text-sm">{m.title}</span>
                                        {m.description && <p className="text-xs text-muted-foreground truncate">{m.description}</p>}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {m.targetDate && (
                                        <span className="text-xs text-muted-foreground">
                                            {new Date(m.targetDate).toLocaleDateString()}
                                        </span>
                                    )}
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDeleteMilestone(m.id)}>
                                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* Agents */}
            <section className="space-y-3">
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                        <Bot className="h-5 w-5" /> Agents ({agents.length})
                    </h2>
                    <Button size="sm" variant="outline" onClick={openAgentDialog}>
                        <Plus className="h-3.5 w-3.5 mr-1" /> Assign
                    </Button>
                </div>
                {agents.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg">No agents assigned yet.</p>
                ) : (
                    <div className="grid gap-2 md:grid-cols-2">
                        {agents.map((a) => (
                            <div key={a.id} className="flex items-center justify-between border rounded-lg px-4 py-3">
                                <div>
                                    <span className="font-medium text-sm">{a.agent?.name || a.agentId}</span>
                                    {a.roleInProject && <span className="text-xs text-muted-foreground ml-2">({a.roleInProject})</span>}
                                </div>
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleRemoveAgent(a.agentId)}>
                                    <X className="h-3.5 w-3.5" />
                                </Button>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* Knowledge Bases */}
            <section className="space-y-3">
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                        <BookOpen className="h-5 w-5" /> Knowledge Bases ({kbs.length})
                    </h2>
                    <Button size="sm" variant="outline" onClick={openKbDialog}>
                        <Plus className="h-3.5 w-3.5 mr-1" /> Link
                    </Button>
                </div>
                {kbs.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg">No knowledge bases linked.</p>
                ) : (
                    <div className="grid gap-2 md:grid-cols-2">
                        {kbs.map((kb) => (
                            <div key={kb.id} className="flex items-center justify-between border rounded-lg px-4 py-3">
                                <div>
                                    <span className="font-medium text-sm">{kb.knowledgeBase?.name || kb.kbId}</span>
                                    {kb.knowledgeBase?.description && (
                                        <p className="text-xs text-muted-foreground">{kb.knowledgeBase.description}</p>
                                    )}
                                </div>
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleRemoveKB(kb.kbId)}>
                                    <X className="h-3.5 w-3.5" />
                                </Button>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* Run Reports */}
            <section className="space-y-3">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                    <FileText className="h-5 w-5" /> Run Reports ({reports.length})
                </h2>
                {reports.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg">No run reports yet. Reports are generated when scheduled agents complete their runs.</p>
                ) : (
                    <div className="space-y-2">
                        {reports.map((r: any) => {
                            const report = r.report || r;
                            const agent = r.agent || {};
                            return (
                                <div key={report.id} className="border rounded-lg px-4 py-3 space-y-1">
                                    <div className="flex items-center justify-between">
                                        <span className="font-medium text-sm">{agent.name || 'Unknown Agent'}</span>
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <Badge variant="outline" className="text-[10px]">{report.runType}</Badge>
                                            {report.createdAt && new Date(report.createdAt).toLocaleString()}
                                        </div>
                                    </div>
                                    <p className="text-sm text-muted-foreground">{report.summary}</p>
                                    {report.issues && (
                                        <p className="text-xs text-red-400">Issues: {report.issues}</p>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>

            {/* Milestone Dialog */}
            <Dialog open={milestoneDialog} onOpenChange={setMilestoneDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Add Milestone</DialogTitle>
                        <DialogDescription>Define a measurable checkpoint for this project.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div>
                            <Label>Title</Label>
                            <Input placeholder="e.g. Collect 100 leads" value={milestoneForm.title} onChange={(e) => setMilestoneForm({ ...milestoneForm, title: e.target.value })} />
                        </div>
                        <div>
                            <Label>Description</Label>
                            <Input placeholder="Optional details" value={milestoneForm.description} onChange={(e) => setMilestoneForm({ ...milestoneForm, description: e.target.value })} />
                        </div>
                        <div>
                            <Label>Target Date</Label>
                            <Input type="date" value={milestoneForm.targetDate} onChange={(e) => setMilestoneForm({ ...milestoneForm, targetDate: e.target.value })} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setMilestoneDialog(false)}>Cancel</Button>
                        <Button onClick={handleCreateMilestone} disabled={!milestoneForm.title.trim()}>Create</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Assign Agent Dialog */}
            <Dialog open={agentDialog} onOpenChange={setAgentDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Assign Agent</DialogTitle>
                        <DialogDescription>Add an agent to this project.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div>
                            <Label>Agent</Label>
                            <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
                                <SelectTrigger><SelectValue placeholder="Select an agent" /></SelectTrigger>
                                <SelectContent>
                                    {allAgents
                                        .filter((a) => !agents.some((pa) => pa.agentId === a.id))
                                        .map((a) => (
                                            <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                                        ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <Label>Role in Project (optional)</Label>
                            <Input placeholder="e.g. Lead Researcher" value={agentRole} onChange={(e) => setAgentRole(e.target.value)} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setAgentDialog(false)}>Cancel</Button>
                        <Button onClick={handleAssignAgent} disabled={!selectedAgentId}>Assign</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Link KB Dialog */}
            <Dialog open={kbDialog} onOpenChange={setKbDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Link Knowledge Base</DialogTitle>
                        <DialogDescription>Link a knowledge base to this project.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div>
                            <Label>Knowledge Base</Label>
                            <Select value={selectedKbId} onValueChange={setSelectedKbId}>
                                <SelectTrigger><SelectValue placeholder="Select a KB" /></SelectTrigger>
                                <SelectContent>
                                    {allKBs
                                        .filter((kb) => !kbs.some((pkb) => pkb.kbId === kb.id))
                                        .map((kb) => (
                                            <SelectItem key={kb.id} value={kb.id}>{kb.name}</SelectItem>
                                        ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setKbDialog(false)}>Cancel</Button>
                        <Button onClick={handleAssignKB} disabled={!selectedKbId}>Link</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
