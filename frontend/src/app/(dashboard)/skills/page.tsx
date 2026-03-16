'use client';

import { useEffect, useState, useCallback } from 'react';
import {
    Zap,
    Plus,
    Trash2,
    Pencil,
    Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
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
import { CreateSkillSheet } from '@/components/skills/create-skill-sheet';
import { useActiveWorkspace } from '@/hooks/use-active-workspace';
import { getSkills, deleteSkill } from '@/lib/api/skills';
import type { Skill } from '@/types';

export default function SkillsPage() {
    const workspace = useActiveWorkspace();
    const [skills, setSkills] = useState<Skill[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
    const [sheetOpen, setSheetOpen] = useState(false);
    const [editSkill, setEditSkill] = useState<Skill | null>(null);

    const fetchSkills = useCallback(async () => {
        if (!workspace) return;
        try {
            setLoading(true);
            const data = await getSkills(workspace.id);
            setSkills(data);
        } catch {
            toast.error('Failed to load skills');
        } finally {
            setLoading(false);
        }
    }, [workspace]);

    useEffect(() => {
        fetchSkills();
    }, [fetchSkills]);

    const handleDelete = async (id: string) => {
        if (!workspace) return;
        try {
            await deleteSkill(workspace.id, id);
            toast.success('Skill deleted');
            if (selectedSkill?.id === id) setSelectedSkill(null);
            fetchSkills();
        } catch {
            toast.error('Failed to delete skill');
        }
    };

    const handleEdit = (skill: Skill) => {
        setEditSkill(skill);
        setSheetOpen(true);
    };

    const handleCreate = () => {
        setEditSkill(null);
        setSheetOpen(true);
    };

    const handleSheetSuccess = () => {
        fetchSkills();
        setSelectedSkill(null);
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20">
                    <Zap className="h-5 w-5 text-amber-600" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Skills</h1>
                    <p className="text-sm text-muted-foreground">
                        Define reusable instructions for your agents
                    </p>
                </div>
            </div>

            {/* Two-column layout */}
            <div className="flex gap-6 h-[calc(100vh-200px)]">
                {/* Left panel — Skill list */}
                <div className="w-[320px] flex-shrink-0 flex flex-col rounded-xl border border-border/60 bg-card overflow-hidden">
                    <div className="p-4 border-b border-border/60 flex items-center justify-between">
                        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                            Skills
                        </h2>
                        <Button size="sm" onClick={handleCreate} className="gap-1.5">
                            <Plus className="h-3.5 w-3.5" />
                            New Skill
                        </Button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-2 space-y-1">
                        {loading ? (
                            Array.from({ length: 4 }).map((_, i) => (
                                <div key={i} className="p-3 space-y-2">
                                    <Skeleton className="h-4 w-32" />
                                    <Skeleton className="h-3 w-48" />
                                </div>
                            ))
                        ) : skills.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-center px-4 gap-3">
                                <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                                    <Sparkles className="h-5 w-5 text-muted-foreground" />
                                </div>
                                <div>
                                    <p className="text-sm font-medium">No skills yet</p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        Create your first skill to extend agent behavior.
                                    </p>
                                </div>
                            </div>
                        ) : (
                            skills.map((skill) => (
                                <div
                                    key={skill.id}
                                    className={`group relative flex items-center gap-3 rounded-lg px-3 py-3 cursor-pointer transition-all duration-150 hover:bg-accent ${
                                        selectedSkill?.id === skill.id
                                            ? 'bg-accent ring-1 ring-border'
                                            : ''
                                    }`}
                                    onClick={() => setSelectedSkill(skill)}
                                >
                                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500/15 to-orange-500/15 flex-shrink-0">
                                        <Zap className="h-4 w-4 text-amber-600" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate">{skill.name}</p>
                                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                                            {skill.instructions.slice(0, 60)}
                                            {skill.instructions.length > 60 ? '...' : ''}
                                        </p>
                                    </div>
                                    <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                            <button
                                                className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                            <AlertDialogHeader>
                                                <AlertDialogTitle>Delete Skill</AlertDialogTitle>
                                                <AlertDialogDescription>
                                                    Delete &quot;{skill.name}&quot;? This cannot be undone.
                                                </AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                <AlertDialogAction
                                                    onClick={() => handleDelete(skill.id)}
                                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                                >
                                                    Delete
                                                </AlertDialogAction>
                                            </AlertDialogFooter>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Right panel — Skill detail */}
                <div className="flex-1 rounded-xl border border-border/60 bg-card overflow-hidden">
                    {selectedSkill ? (
                        <div className="h-full flex flex-col">
                            <div className="p-6 border-b border-border/60">
                                <div className="flex items-start justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/20">
                                            <Zap className="h-7 w-7 text-amber-600" />
                                        </div>
                                        <div>
                                            <h2 className="text-xl font-semibold">{selectedSkill.name}</h2>
                                            {(selectedSkill.description || selectedSkill.origin) && (
                                                <div className="flex items-center gap-2 mt-1">
                                                    {selectedSkill.origin && (
                                                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-violet-500/10 text-violet-600 border-violet-500/20">
                                                            {selectedSkill.origin}
                                                        </Badge>
                                                    )}
                                                    {selectedSkill.description && (
                                                        <span className="text-sm text-muted-foreground">{selectedSkill.description}</span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleEdit(selectedSkill)}
                                        className="gap-1.5"
                                    >
                                        <Pencil className="h-3.5 w-3.5" />
                                        Edit
                                    </Button>
                                </div>
                            </div>

                            <div className="flex-1 p-6 overflow-y-auto space-y-6">
                                <div>
                                    <h3 className="text-sm font-medium text-muted-foreground mb-2">
                                        Instructions
                                    </h3>
                                    <div className="rounded-lg bg-muted/50 border border-border/40 p-4">
                                        <p className="text-sm leading-relaxed whitespace-pre-wrap">
                                            {selectedSkill.instructions}
                                        </p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="rounded-lg bg-muted/50 border border-border/40 p-4">
                                        <p className="text-xs font-medium text-muted-foreground mb-1">Created</p>
                                        <p className="text-sm font-medium">
                                            {new Date(selectedSkill.createdAt).toLocaleDateString('en-US', {
                                                month: 'short', day: 'numeric', year: 'numeric',
                                            })}
                                        </p>
                                    </div>
                                    <div className="rounded-lg bg-muted/50 border border-border/40 p-4">
                                        <p className="text-xs font-medium text-muted-foreground mb-1">Last Updated</p>
                                        <p className="text-sm font-medium">
                                            {new Date(selectedSkill.updatedAt).toLocaleDateString('en-US', {
                                                month: 'short', day: 'numeric', year: 'numeric',
                                            })}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-center px-8 gap-4">
                            <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-amber-500/10 to-orange-500/10 flex items-center justify-center">
                                <Zap className="h-8 w-8 text-muted-foreground/50" />
                            </div>
                            <div>
                                <p className="text-lg font-medium text-muted-foreground">Select a skill</p>
                                <p className="text-sm text-muted-foreground/70 mt-1">
                                    Choose a skill from the list to view its instructions.
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Sheet */}
            {workspace && (
                <CreateSkillSheet
                    open={sheetOpen}
                    onOpenChange={setSheetOpen}
                    workspaceId={workspace.id}
                    skill={editSkill}
                    onSuccess={handleSheetSuccess}
                />
            )}
        </div>
    );
}
