'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
    Layers,
    Plus,
    Trash2,
    Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
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
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useActiveWorkspace } from '@/hooks/use-active-workspace';
import { listProjects, createProject, deleteProject } from '@/lib/api/projects';
import type { Project } from '@/types';

const statusColors: Record<string, string> = {
    active: 'bg-green-500/10 text-green-500 border-green-500/20',
    paused: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    completed: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    archived: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
};

export default function ProjectsPage() {
    const workspace = useActiveWorkspace();
    const router = useRouter();
    const [projects, setProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(true);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [creating, setCreating] = useState(false);
    const [form, setForm] = useState({ name: '', description: '', instructions: '' });

    const fetchProjects = useCallback(async () => {
        if (!workspace) return;
        try {
            setLoading(true);
            const data = await listProjects(workspace.id);
            setProjects(data);
        } catch {
            toast.error('Failed to load projects');
        } finally {
            setLoading(false);
        }
    }, [workspace]);

    useEffect(() => {
        fetchProjects();
    }, [fetchProjects]);

    const handleCreate = async () => {
        if (!workspace || !form.name.trim()) return;
        try {
            setCreating(true);
            await createProject(workspace.id, {
                name: form.name.trim(),
                description: form.description.trim() || undefined,
                instructions: form.instructions.trim() || undefined,
            });
            toast.success('Project created');
            setDialogOpen(false);
            setForm({ name: '', description: '', instructions: '' });
            fetchProjects();
        } catch {
            toast.error('Failed to create project');
        } finally {
            setCreating(false);
        }
    };

    const handleDelete = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (!workspace) return;
        try {
            await deleteProject(workspace.id, id);
            toast.success('Project deleted');
            fetchProjects();
        } catch {
            toast.error('Failed to delete project');
        }
    };

    return (
        <div className="p-6 max-w-6xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold">Projects</h1>
                    <p className="text-muted-foreground text-sm mt-1">
                        Organize agents, knowledge bases, and milestones around specific goals.
                    </p>
                </div>
                <Button onClick={() => setDialogOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create Project
                </Button>
            </div>

            {loading ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {[1, 2, 3].map((i) => (
                        <Skeleton key={i} className="h-40 rounded-xl" />
                    ))}
                </div>
            ) : projects.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                    <Layers className="h-12 w-12 text-muted-foreground/50 mb-4" />
                    <h3 className="text-lg font-medium">No projects yet</h3>
                    <p className="text-muted-foreground text-sm mt-1 max-w-sm">
                        Create a project to organize your agents, knowledge bases, and milestones around a specific goal.
                    </p>
                    <Button className="mt-4" onClick={() => setDialogOpen(true)}>
                        <Plus className="h-4 w-4 mr-2" />
                        Create your first project
                    </Button>
                </div>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {projects.map((project) => (
                        <div
                            key={project.id}
                            className="border rounded-xl p-5 hover:border-foreground/20 transition-colors cursor-pointer group"
                            onClick={() => router.push(`/projects/${project.id}`)}
                        >
                            <div className="flex items-start justify-between">
                                <div className="flex-1 min-w-0">
                                    <h3 className="font-semibold truncate">{project.name}</h3>
                                    {project.description && (
                                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                                            {project.description}
                                        </p>
                                    )}
                                </div>
                                <Badge variant="outline" className={statusColors[project.status] || statusColors.active}>
                                    {project.status}
                                </Badge>
                            </div>
                            <div className="flex items-center justify-between mt-4 text-xs text-muted-foreground">
                                <span>Created {new Date(project.createdAt).toLocaleDateString()}</span>
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7 opacity-0 group-hover:opacity-100"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Delete project?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                This will delete &quot;{project.name}&quot; and all its milestones and assignments. This cannot be undone.
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction onClick={(e) => handleDelete(e, project.id)}>
                                                Delete
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Create Project Dialog */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Create Project</DialogTitle>
                        <DialogDescription>
                            Create a new project to organize work around a specific goal.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div>
                            <Label htmlFor="name">Name</Label>
                            <Input
                                id="name"
                                placeholder="e.g. Dental Leads - LA"
                                value={form.name}
                                onChange={(e) => setForm({ ...form, name: e.target.value })}
                            />
                        </div>
                        <div>
                            <Label htmlFor="description">Description</Label>
                            <Input
                                id="description"
                                placeholder="Brief description of the project goal"
                                value={form.description}
                                onChange={(e) => setForm({ ...form, description: e.target.value })}
                            />
                        </div>
                        <div>
                            <Label htmlFor="instructions">Shared Instructions</Label>
                            <Textarea
                                id="instructions"
                                placeholder="Context shared with all agents in this project..."
                                rows={3}
                                value={form.instructions}
                                onChange={(e) => setForm({ ...form, instructions: e.target.value })}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleCreate} disabled={!form.name.trim() || creating}>
                            {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            Create
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
