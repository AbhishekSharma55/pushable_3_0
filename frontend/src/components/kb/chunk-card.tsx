'use client';

import { useState } from 'react';
import { Pencil, Trash2, Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { updateChunk, deleteChunk } from '@/lib/api/kb';
import type { KBChunk } from '@/types';

interface ChunkCardProps {
    chunk: KBChunk;
    index: number;
    workspaceId: string;
    onUpdate: (updated: KBChunk) => void;
    onDelete: (id: string) => void;
}

export function ChunkCard({ chunk, index, workspaceId, onUpdate, onDelete }: ChunkCardProps) {
    const [mode, setMode] = useState<'view' | 'edit'>('view');
    const [editContent, setEditContent] = useState(chunk.content);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [reEmbedded, setReEmbedded] = useState(false);

    const source = (chunk.metadata?.source as string) || 'uploaded';

    const handleSave = async () => {
        if (editContent.trim().length < 10) {
            toast.error('Content must be at least 10 characters');
            return;
        }
        setSaving(true);
        try {
            const updated = await updateChunk(workspaceId, chunk.id, editContent.trim());
            onUpdate(updated);
            setMode('view');
            setReEmbedded(true);
            setTimeout(() => setReEmbedded(false), 3000);
            toast.success('Chunk updated');
        } catch (err: unknown) {
            const error = err as { response?: { data?: { error?: { message?: string } } } };
            toast.error(error.response?.data?.error?.message || 'Failed to update chunk');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        setDeleting(true);
        try {
            await deleteChunk(workspaceId, chunk.id);
            onDelete(chunk.id);
            toast.success('Chunk deleted');
        } catch (err: unknown) {
            const error = err as { response?: { data?: { error?: { message?: string } } } };
            toast.error(error.response?.data?.error?.message || 'Failed to delete chunk');
            setDeleting(false);
            setConfirmDelete(false);
        }
    };

    const handleCancel = () => {
        setEditContent(chunk.content);
        setMode('view');
    };

    return (
        <div className="rounded-lg border border-border/60 bg-card transition-all duration-200">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/40">
                <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono">
                        #{index + 1}
                    </Badge>
                    <Badge
                        variant="outline"
                        className={`text-[10px] px-1.5 py-0 ${
                            source === 'manual'
                                ? 'bg-amber-500/10 text-amber-600 border-amber-500/20'
                                : 'bg-blue-500/10 text-blue-600 border-blue-500/20'
                        }`}
                    >
                        {source}
                    </Badge>
                    {reEmbedded && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-green-500/10 text-green-600 border-green-500/20 animate-in fade-in">
                            <Check className="h-2.5 w-2.5 mr-0.5" />
                            Re-embedded
                        </Badge>
                    )}
                </div>

                {mode === 'view' && (
                    <div className="flex items-center gap-1">
                        <button
                            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => {
                                setEditContent(chunk.content);
                                setMode('edit');
                            }}
                        >
                            <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                            className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                            onClick={() => setConfirmDelete(true)}
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </button>
                    </div>
                )}
            </div>

            {/* Content */}
            <div className="px-4 py-3">
                {mode === 'view' ? (
                    <>
                        <div className="max-h-48 overflow-y-auto">
                            <pre className="text-sm whitespace-pre-wrap break-words font-mono leading-relaxed text-foreground/90">
                                {chunk.content}
                            </pre>
                        </div>
                        <p className="text-[11px] text-muted-foreground/60 mt-2 text-right">
                            {chunk.content.length} chars
                        </p>
                    </>
                ) : (
                    <div className="space-y-3">
                        <Textarea
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            rows={8}
                            className="font-mono text-sm resize-none"
                        />
                        <div className="flex items-center justify-between">
                            <p className="text-[11px] text-muted-foreground/60">
                                {editContent.length} chars
                            </p>
                            <div className="flex gap-2">
                                <Button size="sm" variant="outline" onClick={handleCancel} disabled={saving}>
                                    Cancel
                                </Button>
                                <Button size="sm" onClick={handleSave} disabled={saving || editContent.trim().length < 10}>
                                    {saving ? (
                                        <>
                                            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                            Saving...
                                        </>
                                    ) : (
                                        'Save'
                                    )}
                                </Button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Inline delete confirm */}
            {confirmDelete && (
                <div className="px-4 py-3 border-t border-border/40 bg-destructive/5 animate-in slide-in-from-top-1">
                    <p className="text-sm text-muted-foreground mb-2">
                        This will permanently delete this chunk and cannot be undone.
                    </p>
                    <div className="flex gap-2 justify-end">
                        <Button size="sm" variant="outline" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                            Cancel
                        </Button>
                        <Button size="sm" variant="destructive" onClick={handleDelete} disabled={deleting}>
                            {deleting ? (
                                <>
                                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                    Deleting...
                                </>
                            ) : (
                                'Confirm'
                            )}
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
