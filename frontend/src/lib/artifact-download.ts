import type { Artifact } from './artifact-parser';

const MIME_TYPES: Record<string, string> = {
    html: 'text/html',
    markdown: 'text/markdown',
    mdx: 'text/mdx',
    txt: 'text/plain',
    csv: 'text/csv',
    pdf: 'application/pdf',
};

function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export async function downloadArtifact(artifact: Artifact): Promise<void> {
    switch (artifact.type) {
        case 'html':
        case 'txt':
        case 'markdown':
        case 'mdx':
        case 'csv': {
            const mime = MIME_TYPES[artifact.type] || 'text/plain';
            const blob = new Blob([artifact.content], { type: mime });
            downloadBlob(blob, artifact.filename);
            break;
        }

        case 'xlsx': {
            // Download as CSV — Excel opens CSV files natively
            const blob = new Blob([artifact.content], { type: 'text/csv' });
            downloadBlob(blob, artifact.filename.replace(/\.xlsx$/, '.csv'));
            break;
        }

        case 'pdf': {
            const popup = window.open('', '_blank');
            if (popup) {
                popup.document.write(artifact.content);
                popup.document.close();
                setTimeout(() => {
                    popup.print();
                }, 500);
            } else {
                // Fallback: download as HTML if popup blocked
                const blob = new Blob([artifact.content], { type: 'text/html' });
                const fallbackName = artifact.filename.replace(/\.pdf$/, '.html');
                downloadBlob(blob, fallbackName);
            }
            break;
        }
    }
}
