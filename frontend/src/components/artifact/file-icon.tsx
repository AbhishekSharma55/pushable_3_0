'use client';

import { Code2, FileText, AlignLeft, Table, BookOpen, File } from 'lucide-react';
import type { ArtifactType } from '@/lib/artifact-parser';

interface FileIconProps {
    type: ArtifactType;
    className?: string;
}

export function FileIcon({ type, className = 'h-4 w-4' }: FileIconProps) {
    switch (type) {
        case 'html':
            return <Code2 className={className} />;
        case 'markdown':
        case 'mdx':
            return <FileText className={className} />;
        case 'txt':
            return <AlignLeft className={className} />;
        case 'csv':
        case 'xlsx':
            return <Table className={className} />;
        case 'pdf':
            return <BookOpen className={className} />;
        default:
            return <File className={className} />;
    }
}
