'use client';

import { useEffect, useState, useCallback } from 'react';
import { X, Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ChunkCard } from './chunk-card';
import {
    getChunksByDocument,
    getChunksByKB,
    addManualChunk,
} from '@/lib/api/kb';
import type { KBChunk } from '@/types';

interface ChunkViewerProps {
    open: boolean;
    mode: 'document' | 'kb';
    kbId: string;
    documentId?: string;
    documentName?: string;
    kbName?: string;
    workspaceId: string;
    onClose: () => void;
    onChunkCountChange?: (documentId: string, delta: number) => void;
}

const PAGE_SIZE = 50;

export function ChunkViewer({
    open,
    mode,
    kbId,
    documentId,
    documentName,
    kbName,
    workspaceId,
    onClose,
    onChunkCountChange,
}: ChunkViewerProps) {
    const [allChunks, setAllChunks] = useState<KBChunk[]>([]);
    const [loading, setLoading] = useState(true);
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    const [showAddForm, setShowAddForm] = useState(false);
    const [newContent, setNewContent] = useState('');
    const [adding, setAdding] = useState(false);

    const fetchChunks = useCallback(async () => {
        setLoading(true);
        try {
            const data =
                mode === 'document' && documentId
                    ? await getChunksByDocument(workspaceId, kbId, documentId)
                    : await getChunksByKB(workspaceId, kbId);
            setAllChunks(data);
            setVisibleCount(PAGE_SIZE);
        } catch {
            toast.error('Failed to load chunks');
        } finally {
            setLoading(false);
        }
    }, [mode, kbId, documentId, workspaceId]);

    useEffect(() => {
        if (open) fetchChunks();
    }, [open, fetchChunks]);

    const handleUpdate = (updated: KBChunk) => {
        setAllChunks((prev) =>
            prev.map((c) => (c.id === updated.id ? updated : c))
        );
    };

    const handleDelete = (id: string) => {
        const deleted = allChunks.find((c) => c.id === id);
        setAllChunks((prev) => prev.filter((c) => c.id !== id));
        if (deleted && onChunkCountChange) {
            onChunkCountChange(deleted.documentId, -1);
        }
    };

    const handleAdd = async () => {
        if (!documentId || newContent.trim().length < 10) return;
        setAdding(true);
        try {
            const chunk = await addManualChunk(workspaceId, kbId, documentId, newContent.trim());
            setAllChunks((prev) => [chunk, ...prev]);
            setNewContent('');
            setShowAddForm(false);
            toast.success('Chunk added');
            if (onChunkCountChange) {
                onChunkCountChange(documentId, 1);
            }
        } catch (err: unknown) {
            const error = err as { response?: { data?: { error?: { message?: string } } } };
            toast.error(error.response?.data?.error?.message || 'Failed to add chunk');
        } finally {
            setAdding(false);
        }
    };

    const visibleChunks = allChunks.slice(0, visibleCount);
    const hasMore = visibleCount < allChunks.length;
    const title =
        mode === 'document'
            ? `Chunks — ${documentName || 'Document'}`
            : `All Chunks — ${kbName || 'KB'}`;

    return (
        <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
            <SheetContent side="right" className="w-[700px] sm:max-w-[700px] p-0 flex flex-col [&>button]:hidden">
                {/* Header */}
                <SheetHeader className="px-6 py-4 border-b border-border/60 flex-shrink-0">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <SheetTitle className="text-lg font-semibold">
                                {title}
                            </SheetTitle>
                            {/* <Badge variant="outline" className="text-xs">
                                {allChunks.length} chunks
                            </Badge> */}
                        </div>
                        <div className="flex items-center gap-2">
                            {mode === 'document' && !showAddForm && (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="gap-1.5"
                                    onClick={() => setShowAddForm(true)}
                                >
                                    <Plus className="h-3.5 w-3.5" />
                                    Add Chunk
                                </Button>
                            )}
                            <button
                                className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                                onClick={onClose}
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                </SheetHeader>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
                    {/* Add chunk form */}
                    {showAddForm && mode === 'document' && (
                        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3 animate-in slide-in-from-top-2">
                            <Textarea
                                value={newContent}
                                onChange={(e) => setNewContent(e.target.value)}
                                placeholder="Type the content of this chunk..."
                                rows={5}
                                className="font-mono text-sm resize-none"
                            />
                            <div className="flex items-center justify-between">
                                <p className="text-[11px] text-muted-foreground/60">
                                    {newContent.length} chars
                                </p>
                                <div className="flex gap-2">
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => {
                                            setShowAddForm(false);
                                            setNewContent('');
                                        }}
                                        disabled={adding}
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        size="sm"
                                        onClick={handleAdd}
                                        disabled={adding || newContent.trim().length < 10}
                                    >
                                        {adding ? (
                                            <>
                                                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                                Adding...
                                            </>
                                        ) : (
                                            'Add Chunk'
                                        )}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Loading */}
                    {loading ? (
                        Array.from({ length: 4 }).map((_, i) => (
                            <div key={i} className="rounded-lg border border-border/60 p-4 space-y-2">
                                <Skeleton className="h-4 w-20" />
                                <Skeleton className="h-16 w-full" />
                            </div>
                        ))
                    ) : allChunks.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
                            <p className="text-sm text-muted-foreground">No chunks found.</p>
                        </div>
                    ) : (
                        <>
                            {visibleChunks.map((chunk, i) => (
                                <ChunkCard
                                    key={chunk.id}
                                    chunk={chunk}
                                    index={i}
                                    workspaceId={workspaceId}
                                    onUpdate={handleUpdate}
                                    onDelete={handleDelete}
                                />
                            ))}

                            {/* Load more / count */}
                            <div className="flex items-center justify-between pt-2 pb-4">
                                <p className="text-xs text-muted-foreground">
                                    Showing {visibleChunks.length} of {allChunks.length} chunks
                                </p>
                                {hasMore && (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}
                                    >
                                        Load more
                                    </Button>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </SheetContent>
        </Sheet>
    );
}
