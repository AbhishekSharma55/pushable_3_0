'use client';

import { CsvPreview } from './csv-preview';

interface XlsxPreviewProps {
    content: string;
}

export function XlsxPreview({ content }: XlsxPreviewProps) {
    return <CsvPreview content={content} />;
}
