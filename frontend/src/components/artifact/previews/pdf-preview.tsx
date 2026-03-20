'use client';

import { HtmlPreview } from './html-preview';

interface PdfPreviewProps {
    content: string;
}

export function PdfPreview({ content }: PdfPreviewProps) {
    return (
        <div>
            <div className="mb-3 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2">
                <p className="text-xs text-amber-700 dark:text-amber-400">
                    Preview (download to get PDF)
                </p>
            </div>
            <HtmlPreview content={content} />
        </div>
    );
}
