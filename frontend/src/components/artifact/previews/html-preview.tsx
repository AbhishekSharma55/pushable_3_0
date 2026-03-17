'use client';

interface HtmlPreviewProps {
    content: string;
}

export function HtmlPreview({ content }: HtmlPreviewProps) {
    return (
        <iframe
            srcDoc={content}
            sandbox="allow-scripts allow-same-origin"
            className="w-full border-none"
            style={{ minHeight: '600px', height: '100%' }}
            title="HTML Preview"
        />
    );
}
