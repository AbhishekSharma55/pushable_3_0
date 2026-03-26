'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import {
    FolderOpen,
    Upload,
    Trash2,
    Download,
    Search,
    FileText,
    Image as ImageIcon,
    File as FileIcon,
    FolderPlus,
    Loader2,
    Paperclip,
    X,
    MoreVertical,
    Pencil,
    FolderInput,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useActiveWorkspace } from '@/hooks/use-active-workspace';
import { listFiles, listFolders, uploadFile, deleteFile, renameFile, moveFile, getStorageUsage, getFileDownloadUrl } from '@/lib/api/bucket';
import { getToken } from '@/lib/auth';
import { API_URL } from '@/lib/constants';
import { cn } from '@/lib/utils';
import type { BucketFile } from '@/types';

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(mimeType: string) {
    if (mimeType.startsWith('image/')) return <ImageIcon className="h-4 w-4 text-blue-500" />;
    if (mimeType === 'application/pdf') return <FileText className="h-4 w-4 text-red-500" />;
    if (mimeType.startsWith('text/')) return <FileText className="h-4 w-4 text-green-500" />;
    return <FileIcon className="h-4 w-4 text-muted-foreground" />;
}

function getSourceLabel(source: string) {
    switch (source) {
        case 'chat_upload': return 'Chat';
        case 'agent_generated': return 'Agent';
        case 'api_upload': return 'Upload';
        default: return source;
    }
}

export default function FilesPage() {
    const workspace = useActiveWorkspace();
    const [files, setFiles] = useState<BucketFile[]>([]);
    const [folders, setFolders] = useState<string[]>(['/']);
    const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [isDragOver, setIsDragOver] = useState(false);
    const [usage, setUsage] = useState<{ totalBytes: number; fileCount: number; limitBytes: number; usedPercent: number } | null>(null);

    // Dialogs
    const [fileToDelete, setFileToDelete] = useState<BucketFile | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [renameDialog, setRenameDialog] = useState<BucketFile | null>(null);
    const [newFilename, setNewFilename] = useState('');
    const [moveDialog, setMoveDialog] = useState<BucketFile | null>(null);
    const [moveTarget, setMoveTarget] = useState('');
    const [newFolderDialog, setNewFolderDialog] = useState(false);
    const [newFolderPath, setNewFolderPath] = useState('');

    const fileInputRef = useRef<HTMLInputElement>(null);

    const fetchFiles = useCallback(async () => {
        if (!workspace?.id) return;
        try {
            setLoading(true);
            const [fileData, folderData, usageData] = await Promise.all([
                listFiles(workspace.id, {
                    folder: selectedFolder || undefined,
                    search: search || undefined,
                }),
                listFolders(workspace.id),
                getStorageUsage(workspace.id),
            ]);
            setFiles(fileData);
            setFolders(Array.from(new Set(['/', ...folderData])));
            setUsage(usageData);
        } catch {
            toast.error('Failed to load files');
        } finally {
            setLoading(false);
        }
    }, [workspace?.id, selectedFolder, search]);

    useEffect(() => {
        fetchFiles();
    }, [fetchFiles]);

    const handleUpload = async (fileList: FileList | File[]) => {
        if (!workspace?.id) return;
        const filesToUpload = Array.from(fileList);
        if (filesToUpload.length === 0) return;

        setUploading(true);
        try {
            for (const file of filesToUpload) {
                await uploadFile(workspace.id, file, selectedFolder || '/');
            }
            toast.success(`${filesToUpload.length} file(s) uploaded`);
            fetchFiles();
        } catch {
            toast.error('Failed to upload files');
        } finally {
            setUploading(false);
        }
    };

    const handleDelete = async () => {
        if (!workspace?.id || !fileToDelete) return;
        setDeleting(true);
        try {
            await deleteFile(workspace.id, fileToDelete.id);
            toast.success(`Deleted ${fileToDelete.filename}`);
            setFileToDelete(null);
            fetchFiles();
        } catch {
            toast.error('Failed to delete file');
        } finally {
            setDeleting(false);
        }
    };

    const handleRename = async () => {
        if (!workspace?.id || !renameDialog || !newFilename.trim()) return;
        try {
            await renameFile(workspace.id, renameDialog.id, newFilename.trim());
            toast.success('File renamed');
            setRenameDialog(null);
            fetchFiles();
        } catch {
            toast.error('Failed to rename file');
        }
    };

    const handleMove = async () => {
        if (!workspace?.id || !moveDialog || !moveTarget.trim()) return;
        try {
            await moveFile(workspace.id, moveDialog.id, moveTarget.trim());
            toast.success('File moved');
            setMoveDialog(null);
            fetchFiles();
        } catch {
            toast.error('Failed to move file');
        }
    };

    const handleDownload = (file: BucketFile) => {
        const token = getToken();
        const url = `${API_URL}/api/bucket/files/${file.id}/download`;
        // Open in new tab with auth header via fetch + blob
        fetch(url, {
            headers: {
                Authorization: `Bearer ${token}`,
                'x-workspace-id': workspace?.id || '',
            },
        })
            .then((res) => res.blob())
            .then((blob) => {
                const blobUrl = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = blobUrl;
                a.download = file.filename;
                a.click();
                URL.revokeObjectURL(blobUrl);
            })
            .catch(() => toast.error('Failed to download file'));
    };

    return (
        <div className="flex h-[calc(100vh-64px)]">
            {/* Folder sidebar */}
            <div className="w-[250px] shrink-0 border-r border-border p-4 overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-foreground">Folders</h3>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setNewFolderDialog(true); setNewFolderPath('/'); }}>
                        <FolderPlus className="h-3.5 w-3.5" />
                    </Button>
                </div>
                <div className="space-y-1">
                    <button
                        onClick={() => setSelectedFolder(null)}
                        className={cn(
                            "w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors",
                            selectedFolder === null ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted"
                        )}
                    >
                        <FolderOpen className="h-4 w-4" />
                        All Files
                    </button>
                    {folders.map((folder) => (
                        <button
                            key={folder}
                            onClick={() => setSelectedFolder(folder)}
                            className={cn(
                                "w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors",
                                selectedFolder === folder ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted"
                            )}
                        >
                            <FolderOpen className="h-3.5 w-3.5" />
                            <span className="truncate">{folder}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* File list */}
            <div
                className="flex-1 flex flex-col overflow-hidden relative"
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={(e) => { e.preventDefault(); setIsDragOver(false); }}
                onDrop={(e) => { e.preventDefault(); setIsDragOver(false); if (e.dataTransfer.files.length > 0) handleUpload(e.dataTransfer.files); }}
            >
                {/* Drag overlay */}
                {isDragOver && (
                    <div className="absolute inset-0 z-50 bg-primary/5 border-2 border-dashed border-primary/40 rounded-lg flex items-center justify-center pointer-events-none">
                        <div className="flex flex-col items-center gap-2 text-primary">
                            <Upload className="w-8 h-8" />
                            <p className="text-sm font-medium">Drop files here to upload</p>
                        </div>
                    </div>
                )}

                {/* Toolbar */}
                <div className="shrink-0 p-4 border-b border-border flex items-center gap-3">
                    <h2 className="text-lg font-semibold text-foreground">Files</h2>
                    <div className="flex-1" />
                    <div className="relative w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search files..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="pl-9 h-9"
                        />
                    </div>
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(e) => { if (e.target.files) handleUpload(e.target.files); e.target.value = ''; }}
                    />
                    <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="gap-1.5">
                        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                        Upload
                    </Button>
                </div>

                {/* File table */}
                <div className="flex-1 overflow-y-auto">
                    {loading ? (
                        <div className="p-4 space-y-3">
                            {Array.from({ length: 5 }).map((_, i) => (
                                <Skeleton key={i} className="h-12 w-full" />
                            ))}
                        </div>
                    ) : files.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                            <FolderOpen className="h-12 w-12 opacity-30" />
                            <p className="text-sm">No files yet</p>
                            <p className="text-xs">Upload files or use agent bucket tools to get started</p>
                        </div>
                    ) : (
                        <table className="w-full">
                            <thead className="bg-muted/30 sticky top-0">
                                <tr className="text-xs text-muted-foreground">
                                    <th className="text-left px-4 py-2.5 font-medium">Name</th>
                                    <th className="text-left px-4 py-2.5 font-medium w-24">Size</th>
                                    <th className="text-left px-4 py-2.5 font-medium w-28">Source</th>
                                    <th className="text-left px-4 py-2.5 font-medium w-32">Folder</th>
                                    <th className="text-left px-4 py-2.5 font-medium w-32">Date</th>
                                    <th className="w-12"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {files.map((file) => (
                                    <tr key={file.id} className="hover:bg-muted/20 transition-colors group">
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-2.5">
                                                {getFileIcon(file.mimeType)}
                                                <span className="text-sm font-medium truncate max-w-[300px]">{file.filename}</span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-sm text-muted-foreground">{formatFileSize(Number(file.sizeBytes))}</td>
                                        <td className="px-4 py-3">
                                            <span className={cn(
                                                "text-xs px-2 py-0.5 rounded-full font-medium",
                                                file.source === 'agent_generated' ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" :
                                                file.source === 'chat_upload' ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" :
                                                "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400"
                                            )}>
                                                {getSourceLabel(file.source)}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-sm text-muted-foreground truncate max-w-[120px]">{file.folder}</td>
                                        <td className="px-4 py-3 text-sm text-muted-foreground">{new Date(file.createdAt).toLocaleDateString()}</td>
                                        <td className="px-4 py-3">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button size="icon" variant="ghost" className="h-7 w-7 opacity-0 group-hover:opacity-100">
                                                        <MoreVertical className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem onClick={() => handleDownload(file)}>
                                                        <Download className="h-4 w-4 mr-2" /> Download
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem onClick={() => { setRenameDialog(file); setNewFilename(file.filename); }}>
                                                        <Pencil className="h-4 w-4 mr-2" /> Rename
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem onClick={() => { setMoveDialog(file); setMoveTarget(file.folder); }}>
                                                        <FolderInput className="h-4 w-4 mr-2" /> Move
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem className="text-destructive" onClick={() => setFileToDelete(file)}>
                                                        <Trash2 className="h-4 w-4 mr-2" /> Delete
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* Storage usage bar */}
                {usage && (
                    <div className="shrink-0 px-4 py-3 border-t border-border flex items-center gap-3 text-xs text-muted-foreground">
                        <span>{usage.fileCount} file(s)</span>
                        <span>|</span>
                        <span>{formatFileSize(usage.totalBytes)} / {formatFileSize(usage.limitBytes)} ({usage.usedPercent}%)</span>
                        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden max-w-[200px]">
                            <div
                                className={cn(
                                    "h-full rounded-full transition-all",
                                    usage.usedPercent > 90 ? "bg-destructive" : usage.usedPercent > 70 ? "bg-amber-500" : "bg-primary"
                                )}
                                style={{ width: `${Math.min(usage.usedPercent, 100)}%` }}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Delete confirmation */}
            <AlertDialog open={!!fileToDelete} onOpenChange={() => setFileToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete file</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to delete &ldquo;{fileToDelete?.filename}&rdquo;? This cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Rename dialog */}
            <Dialog open={!!renameDialog} onOpenChange={() => setRenameDialog(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Rename file</DialogTitle>
                        <DialogDescription>Enter a new name for this file.</DialogDescription>
                    </DialogHeader>
                    <Input value={newFilename} onChange={(e) => setNewFilename(e.target.value)} placeholder="New filename" />
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setRenameDialog(null)}>Cancel</Button>
                        <Button onClick={handleRename} disabled={!newFilename.trim()}>Rename</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Move dialog */}
            <Dialog open={!!moveDialog} onOpenChange={() => setMoveDialog(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Move file</DialogTitle>
                        <DialogDescription>Enter the destination folder path.</DialogDescription>
                    </DialogHeader>
                    <Input value={moveTarget} onChange={(e) => setMoveTarget(e.target.value)} placeholder="/folder/path" />
                    <div className="flex flex-wrap gap-1.5">
                        {folders.map((f) => (
                            <button key={f} onClick={() => setMoveTarget(f)} className={cn("text-xs px-2 py-1 rounded border", moveTarget === f ? "border-primary bg-primary/10" : "border-border hover:bg-muted")}>
                                {f}
                            </button>
                        ))}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setMoveDialog(null)}>Cancel</Button>
                        <Button onClick={handleMove} disabled={!moveTarget.trim()}>Move</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* New folder dialog */}
            <Dialog open={newFolderDialog} onOpenChange={setNewFolderDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Create folder</DialogTitle>
                        <DialogDescription>Enter a folder path (e.g. /reports/2026).</DialogDescription>
                    </DialogHeader>
                    <Input value={newFolderPath} onChange={(e) => setNewFolderPath(e.target.value)} placeholder="/folder-name" />
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setNewFolderDialog(false)}>Cancel</Button>
                        <Button onClick={() => {
                            if (newFolderPath.trim() && newFolderPath.startsWith('/')) {
                                setFolders((prev) => Array.from(new Set([...prev, newFolderPath.trim()])));
                                setNewFolderDialog(false);
                                toast.success('Folder created');
                            }
                        }} disabled={!newFolderPath.trim() || !newFolderPath.startsWith('/')}>
                            Create
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
