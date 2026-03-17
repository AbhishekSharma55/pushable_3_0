'use client';

import { useEffect, useCallback, useState } from 'react';
import { X, Download, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FileIcon } from './file-icon';
import { downloadArtifact } from '@/lib/artifact-download';
import type { Artifact } from '@/lib/artifact-parser';
import { HtmlPreview } from './previews/html-preview';
import { MarkdownPreview } from './previews/markdown-preview';
import { TxtPreview } from './previews/txt-preview';
import { CsvPreview } from './previews/csv-preview';
import { XlsxPreview } from './previews/xlsx-preview';
import { PdfPreview } from './previews/pdf-preview';

interface ArtifactPanelProps {
    artifact: Artifact;
    onClose: () => void;
}

function PreviewContent({ artifact }: { artifact: Artifact }) {
    switch (artifact.type) {
        case 'html':
            return <HtmlPreview content={artifact.content} />;
        case 'markdown':
        case 'mdx':
            return <MarkdownPreview content={artifact.content} />;
        case 'txt':
            return <TxtPreview content={artifact.content} />;
        case 'csv':
            return <CsvPreview content={artifact.content} />;
        case 'xlsx':
            return <XlsxPreview content={artifact.content} />;
        case 'pdf':
            return <PdfPreview content={artifact.content} />;
        default:
            return <TxtPreview content={artifact.content} />;
    }
}

export function ArtifactPanel({ artifact, onClose }: ArtifactPanelProps) {
    const [copied, setCopied] = useState(false);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        requestAnimationFrame(() => setVisible(true));
    }, []);

    const handleClose = useCallback(() => {
        setVisible(false);
        setTimeout(onClose, 300);
    }, [onClose]);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') handleClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [handleClose]);

    const handleDownload = async () => {
        try {
            await downloadArtifact(artifact);
        } catch {
            toast.error('Failed to download');
        }
    };

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(artifact.content);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            toast.error('Failed to copy');
        }
    };

    const typeLabel = artifact.type.toUpperCase();

    return (
        <>
            {/* Backdrop */}
            <div
                className={`fixed inset-0 bg-black/20 z-40 transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}
                onClick={handleClose}
            />

            {/* Panel */}
            <div
                className={`fixed top-0 right-0 h-screen z-50 bg-background border-l border-border shadow-2xl flex flex-col transition-transform duration-300 ease-out ${
                    visible ? 'translate-x-0' : 'translate-x-full'
                }`}
                style={{ width: '45vw', minWidth: '500px' }}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-border flex-shrink-0">
                    <div className="flex items-center gap-3 min-w-0">
                        <FileIcon type={artifact.type} className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                        <span className="text-sm font-semibold truncate">{artifact.filename}</span>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 flex-shrink-0">
                            {typeLabel}
                        </Badge>
                    </div>

                    <div className="flex items-center gap-1 flex-shrink-0">
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={handleCopy} title="Copy content">
                            {copied ? (
                                <Check className="h-4 w-4 text-green-500" />
                            ) : (
                                <Copy className="h-4 w-4" />
                            )}
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={handleDownload} title="Download">
                            <Download className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={handleClose} title="Close (Esc)">
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                {/* Preview */}
                <div className="flex-1 overflow-auto p-6 bg-white dark:bg-background">
                    <PreviewContent artifact={artifact} />
                </div>
            </div>
        </>
    );
}
