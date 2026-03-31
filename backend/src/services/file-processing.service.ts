import { logger } from "../lib/logger.ts";

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

const IMAGE_MIMETYPES = new Set([
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
]);

const DOCUMENT_EXTENSIONS = new Set([
    ".pdf",
    ".docx",
    ".txt",
    ".md",
    ".csv",
]);

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

// ── Types ────────────────────────────────────────────────────────────────────

export interface ProcessedAttachment {
    /** Original filename */
    filename: string;
    /** MIME type */
    mimetype: string;
    /** "image" or "document" */
    type: "image" | "document";
    /** For images: base64-encoded data URL. For documents: extracted text. */
    content: string;
    /** File size in bytes */
    size: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getExtension(filename: string): string {
    return (filename.match(/\.[^.]+$/)?.[0] || "").toLowerCase();
}

function isImageFile(filename: string, mimetype: string): boolean {
    return IMAGE_MIMETYPES.has(mimetype) || IMAGE_EXTENSIONS.has(getExtension(filename));
}

function isDocumentFile(filename: string, mimetype: string): boolean {
    const ext = getExtension(filename);
    return (
        DOCUMENT_EXTENSIONS.has(ext) ||
        mimetype === "application/pdf" ||
        mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        mimetype === "text/plain" ||
        mimetype === "text/markdown" ||
        mimetype === "text/csv"
    );
}

async function extractTextFromPDF(buffer: Buffer): Promise<string> {
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const data = new Uint8Array(buffer);
    const doc = await pdfjsLib.getDocument({ data }).promise;

    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
        try {
            const page = await doc.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items
                .map((item: unknown) => (item as { str?: string }).str ?? "")
                .join(" ");
            pages.push(pageText);
        } catch (err) {
            logger.warn({ page: i, err }, "Failed to extract text from PDF page");
        }
    }

    return pages.join("\n\n");
}

async function extractTextFromDocx(buffer: Buffer): Promise<string> {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
}

// ── Service ──────────────────────────────────────────────────────────────────

export const fileProcessingService = {
    /**
     * Process a single uploaded file into a format suitable for LLM consumption.
     * - Images → base64 data URL
     * - PDFs → extracted text
     * - DOCX → extracted text
     * - Text files → raw text
     */
    async processFile(
        filename: string,
        mimetype: string,
        buffer: Buffer
    ): Promise<ProcessedAttachment> {
        if (buffer.length > MAX_FILE_SIZE) {
            throw new Error(
                `File "${filename}" exceeds maximum size of ${MAX_FILE_SIZE / (1024 * 1024)}MB`
            );
        }

        // ── Images ───────────────────────────────────────────────────
        if (isImageFile(filename, mimetype)) {
            const base64 = buffer.toString("base64");
            // Normalize mimetype for common extensions
            let normalizedMime = mimetype;
            if (!IMAGE_MIMETYPES.has(mimetype)) {
                const ext = getExtension(filename);
                const mimeMap: Record<string, string> = {
                    ".png": "image/png",
                    ".jpg": "image/jpeg",
                    ".jpeg": "image/jpeg",
                    ".gif": "image/gif",
                    ".webp": "image/webp",
                };
                normalizedMime = mimeMap[ext] || "image/png";
            }

            return {
                filename,
                mimetype: normalizedMime,
                type: "image",
                content: `data:${normalizedMime};base64,${base64}`,
                size: buffer.length,
            };
        }

        // ── Documents ────────────────────────────────────────────────
        if (isDocumentFile(filename, mimetype)) {
            const ext = getExtension(filename);
            let text: string;

            if (ext === ".pdf" || mimetype === "application/pdf") {
                text = await extractTextFromPDF(buffer);
            } else if (
                ext === ".docx" ||
                mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            ) {
                text = await extractTextFromDocx(buffer);
            } else {
                // .txt, .md, .csv — read as UTF-8
                text = buffer.toString("utf-8");
            }

            if (!text.trim()) {
                throw new Error(
                    `Could not extract text from "${filename}". The file may be empty or contain only images.`
                );
            }

            return {
                filename,
                mimetype,
                type: "document",
                content: text,
                size: buffer.length,
            };
        }

        throw new Error(
            `Unsupported file type: "${filename}" (${mimetype}). Supported: images (PNG, JPG, GIF, WebP), PDF, DOCX, TXT, MD, CSV.`
        );
    },

    /**
     * Process multiple files in parallel.
     */
    async processFiles(
        files: Array<{ filename: string; mimetype: string; buffer: Buffer }>
    ): Promise<ProcessedAttachment[]> {
        return Promise.all(
            files.map((f) => this.processFile(f.filename, f.mimetype, f.buffer))
        );
    },

    /**
     * Check if a filename/mimetype combination is supported.
     */
    isSupported(filename: string, mimetype: string): boolean {
        return isImageFile(filename, mimetype) || isDocumentFile(filename, mimetype);
    },
};
