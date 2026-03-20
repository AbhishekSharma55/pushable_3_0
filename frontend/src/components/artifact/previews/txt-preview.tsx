'use client';

interface TxtPreviewProps {
    content: string;
}

export function TxtPreview({ content }: TxtPreviewProps) {
    return (
        <pre className="text-sm font-mono whitespace-pre-wrap break-words leading-relaxed text-foreground/90 overflow-auto">
            {content}
        </pre>
    );
}
