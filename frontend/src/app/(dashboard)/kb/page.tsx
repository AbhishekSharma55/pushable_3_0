'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
    BookOpen,
    Plus,
    Trash2,
    Upload,
    FileText,
    Pencil,
    Loader2,
    Sparkles,
    Hash,
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
import { CreateKBSheet } from '@/components/kb/create-kb-sheet';
import { useActiveWorkspace } from '@/hooks/use-active-workspace';
import {
    getKBs,
    deleteKB,
    getDocuments,
    uploadDocument,
    deleteDocument,
} from '@/lib/api/kb';
import type { KnowledgeBase, KBDocument } from '@/types';

interface UploadingDoc {
    id: string;
    filename: string;
}

export default function KBPage() {
    const workspace = useActiveWorkspace();
    const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedKB, setSelectedKB] = useState<KnowledgeBase | null>(null);
    const [documents, setDocuments] = useState<KBDocument[]>([]);
    const [loadingDocs, setLoadingDocs] = useState(false);
    const [uploadingDocs, setUploadingDocs] = useState<UploadingDoc[]>([]);
    const [sheetOpen, setSheetOpen] = useState(false);
    const [editKB, setEditKB] = useState<KnowledgeBase | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const fetchKBs = useCallback(async () => {
        if (!workspace) return;
        try {
            setLoading(true);
            const data = await getKBs(workspace.id);
            setKbs(data);
        } catch {
            toast.error('Failed to load knowledge bases');
        } finally {
            setLoading(false);
        }
    }, [workspace]);

    useEffect(() => {
        fetchKBs();
    }, [fetchKBs]);

    const fetchDocuments = useCallback(async () => {
        if (!workspace || !selectedKB) {
            setDocuments([]);
            return;
        }
        try {
            setLoadingDocs(true);
            const data = await getDocuments(workspace.id, selectedKB.id);
            setDocuments(data);
        } catch {
            toast.error('Failed to load documents');
        } finally {
            setLoadingDocs(false);
        }
    }, [workspace, selectedKB]);

    useEffect(() => {
        fetchDocuments();
    }, [fetchDocuments]);

    const handleDeleteKB = async (id: string) => {
        if (!workspace) return;
        try {
            await deleteKB(workspace.id, id);
            toast.success('Knowledge base deleted');
            if (selectedKB?.id === id) {
                setSelectedKB(null);
                setDocuments([]);
            }
            fetchKBs();
        } catch {
            toast.error('Failed to delete knowledge base');
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!workspace || !selectedKB || !e.target.files?.length) return;
        const file = e.target.files[0];
        e.target.value = '';

        const tempId = `uploading-${Date.now()}`;
        setUploadingDocs((prev) => [...prev, { id: tempId, filename: file.name }]);

        try {
            const doc = await uploadDocument(workspace.id, selectedKB.id, file);
            setDocuments((prev) => [...prev, doc]);
            toast.success(`"${file.name}" uploaded — ${doc.chunkCount} chunks`);
        } catch (err: unknown) {
            const error = err as { response?: { data?: { error?: { message?: string } } } };
            toast.error(
                error.response?.data?.error?.message ||
                `Failed to upload "${file.name}"`
            );
        } finally {
            setUploadingDocs((prev) => prev.filter((d) => d.id !== tempId));
        }
    };

    const handleDeleteDoc = async (docId: string) => {
        if (!workspace || !selectedKB) return;
        try {
            await deleteDocument(workspace.id, selectedKB.id, docId);
            setDocuments((prev) => prev.filter((d) => d.id !== docId));
            toast.success('Document deleted');
        } catch {
            toast.error('Failed to delete document');
        }
    };

    const handleCreate = () => {
        setEditKB(null);
        setSheetOpen(true);
    };

    const handleEdit = () => {
        setEditKB(selectedKB);
        setSheetOpen(true);
    };

    const handleSheetSuccess = () => {
        fetchKBs();
        setSelectedKB(null);
    };

    const totalChunks = documents.reduce((sum, d) => sum + d.chunkCount, 0);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20">
                    <BookOpen className="h-5 w-5 text-emerald-600" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Knowledge Bases</h1>
                    <p className="text-sm text-muted-foreground">
                        Upload documents to give your agents context
                    </p>
                </div>
            </div>

            {/* Three-column layout */}
            <div className="flex gap-4 h-[calc(100vh-200px)]">
                {/* Column 1 — KB list */}
                <div className="w-[200px] flex-shrink-0 flex flex-col rounded-xl border border-border/60 bg-card overflow-hidden">
                    <div className="p-3 border-b border-border/60 flex items-center justify-between">
                        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            KBs
                        </h2>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={handleCreate}>
                            <Plus className="h-3.5 w-3.5" />
                        </Button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
                        {loading ? (
                            Array.from({ length: 3 }).map((_, i) => (
                                <div key={i} className="p-2.5">
                                    <Skeleton className="h-4 w-24" />
                                </div>
                            ))
                        ) : kbs.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-center px-3 gap-2">
                                <Sparkles className="h-4 w-4 text-muted-foreground/50" />
                                <p className="text-xs text-muted-foreground">No KBs yet</p>
                            </div>
                        ) : (
                            kbs.map((kb) => (
                                <div
                                    key={kb.id}
                                    className={`group flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer transition-all duration-150 hover:bg-accent ${
                                        selectedKB?.id === kb.id ? 'bg-accent ring-1 ring-border' : ''
                                    }`}
                                    onClick={() => setSelectedKB(kb)}
                                >
                                    <BookOpen className="h-3.5 w-3.5 text-emerald-600 flex-shrink-0" />
                                    <span className="text-sm truncate flex-1">{kb.name}</span>
                                    <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                            <button
                                                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <Trash2 className="h-3 w-3" />
                                            </button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                            <AlertDialogHeader>
                                                <AlertDialogTitle>Delete Knowledge Base</AlertDialogTitle>
                                                <AlertDialogDescription>
                                                    This will delete &quot;{kb.name}&quot; and all its documents. This cannot be undone.
                                                </AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                <AlertDialogAction
                                                    onClick={() => handleDeleteKB(kb.id)}
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

                {/* Column 2 — Documents */}
                <div className="flex-1 flex flex-col rounded-xl border border-border/60 bg-card overflow-hidden">
                    {selectedKB ? (
                        <>
                            <div className="p-4 border-b border-border/60 flex items-center justify-between">
                                <h2 className="text-sm font-semibold">
                                    Documents in {selectedKB.name}
                                </h2>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="gap-1.5"
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    <Upload className="h-3.5 w-3.5" />
                                    Upload
                                </Button>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    className="hidden"
                                    accept=".txt,.md,.pdf"
                                    onChange={handleFileUpload}
                                />
                            </div>

                            <div className="flex-1 overflow-y-auto p-3 space-y-2">
                                {loadingDocs ? (
                                    Array.from({ length: 3 }).map((_, i) => (
                                        <div key={i} className="p-3">
                                            <Skeleton className="h-4 w-48" />
                                        </div>
                                    ))
                                ) : documents.length === 0 && uploadingDocs.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-full text-center gap-3">
                                        <FileText className="h-8 w-8 text-muted-foreground/30" />
                                        <div>
                                            <p className="text-sm font-medium text-muted-foreground">
                                                No documents yet
                                            </p>
                                            <p className="text-xs text-muted-foreground/70 mt-1">
                                                Upload your first file (.txt, .md, or .pdf).
                                            </p>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        {uploadingDocs.map((doc) => (
                                            <div
                                                key={doc.id}
                                                className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 px-4 py-3"
                                            >
                                                <Loader2 className="h-4 w-4 animate-spin text-emerald-600 flex-shrink-0" />
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-medium truncate">{doc.filename}</p>
                                                    <p className="text-xs text-muted-foreground">Processing...</p>
                                                </div>
                                            </div>
                                        ))}

                                        {documents.map((doc) => (
                                            <div
                                                key={doc.id}
                                                className="group flex items-center gap-3 rounded-lg border border-border/60 px-4 py-3"
                                            >
                                                <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-medium truncate">{doc.filename}</p>
                                                    <div className="flex items-center gap-2 mt-0.5">
                                                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                                                            <Hash className="h-2.5 w-2.5 mr-0.5" />
                                                            {doc.chunkCount} chunks
                                                        </Badge>
                                                        <span className="text-[11px] text-muted-foreground">
                                                            {new Date(doc.createdAt).toLocaleDateString('en-US', {
                                                                month: 'short', day: 'numeric',
                                                            })}
                                                        </span>
                                                    </div>
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
                                                            <AlertDialogTitle>Delete Document</AlertDialogTitle>
                                                            <AlertDialogDescription>
                                                                Delete &quot;{doc.filename}&quot; and all its chunks?
                                                            </AlertDialogDescription>
                                                        </AlertDialogHeader>
                                                        <AlertDialogFooter>
                                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                            <AlertDialogAction
                                                                onClick={() => handleDeleteDoc(doc.id)}
                                                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                                            >
                                                                Delete
                                                            </AlertDialogAction>
                                                        </AlertDialogFooter>
                                                    </AlertDialogContent>
                                                </AlertDialog>
                                            </div>
                                        ))}
                                    </>
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
                            <FileText className="h-8 w-8 text-muted-foreground/30" />
                            <p className="text-sm text-muted-foreground">
                                Select a knowledge base to view documents
                            </p>
                        </div>
                    )}
                </div>

                {/* Column 3 — KB info */}
                <div className="w-[280px] flex-shrink-0 rounded-xl border border-border/60 bg-card overflow-hidden">
                    {selectedKB ? (
                        <div className="p-5 space-y-5">
                            <div className="flex items-start justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20">
                                        <BookOpen className="h-5 w-5 text-emerald-600" />
                                    </div>
                                    <h2 className="text-lg font-semibold">{selectedKB.name}</h2>
                                </div>
                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={handleEdit}>
                                    <Pencil className="h-3.5 w-3.5" />
                                </Button>
                            </div>

                            {selectedKB.description && (
                                <div>
                                    <p className="text-xs font-medium text-muted-foreground mb-1">Description</p>
                                    <p className="text-sm leading-relaxed">{selectedKB.description}</p>
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-3">
                                <div className="rounded-lg bg-muted/50 border border-border/40 p-3">
                                    <p className="text-xs font-medium text-muted-foreground mb-0.5">Documents</p>
                                    <p className="text-lg font-semibold">{documents.length}</p>
                                </div>
                                <div className="rounded-lg bg-muted/50 border border-border/40 p-3">
                                    <p className="text-xs font-medium text-muted-foreground mb-0.5">Chunks</p>
                                    <p className="text-lg font-semibold">{totalChunks}</p>
                                </div>
                            </div>

                            <div className="rounded-lg bg-muted/50 border border-border/40 p-3">
                                <p className="text-xs font-medium text-muted-foreground mb-0.5">Created</p>
                                <p className="text-sm">
                                    {new Date(selectedKB.createdAt).toLocaleDateString('en-US', {
                                        month: 'short', day: 'numeric', year: 'numeric',
                                    })}
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-center px-6 gap-3">
                            <BookOpen className="h-8 w-8 text-muted-foreground/30" />
                            <p className="text-sm text-muted-foreground">
                                Select a KB to see details
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* Sheet */}
            {workspace && (
                <CreateKBSheet
                    open={sheetOpen}
                    onOpenChange={setSheetOpen}
                    workspaceId={workspace.id}
                    kb={editKB}
                    onSuccess={handleSheetSuccess}
                />
            )}
        </div>
    );
}
