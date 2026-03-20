import { kbRepository } from "../repositories/kb.repository.ts";
import { NotFoundError, AppError } from "../lib/errors.ts";
import { generateEmbeddings, generateEmbedding } from "../lib/embeddings.ts";
import { logger } from "../lib/logger.ts";
import { checkCredits, deductCredits, BASE_CREDIT_COSTS } from "../lib/credit-engine.ts";

const ALLOWED_TYPES = new Set([
    "text/plain",
    "text/markdown",
    "application/pdf",
]);

const ALLOWED_EXTENSIONS = new Set([".txt", ".md", ".pdf"]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// ~2000 chars per chunk, 200 char overlap
const CHUNK_SIZE = 2000;
const CHUNK_OVERLAP = 200;

function chunkText(text: string): string[] {
    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
        const end = Math.min(start + CHUNK_SIZE, text.length);
        chunks.push(text.slice(start, end));
        start = end - CHUNK_OVERLAP;
        if (start + CHUNK_OVERLAP >= text.length) break;
    }
    return chunks.filter((c) => c.trim().length > 0);
}

async function extractTextFromPDF(buffer: Buffer): Promise<string> {
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

    const data = new Uint8Array(buffer);
    const doc = await pdfjsLib.getDocument({ data }).promise;

    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
        try {
            const page = await doc.getPage(i);
            const content = await page.getTextContent();
            const text = content.items
                .map((item: unknown) => {
                    const obj = item as Record<string, unknown>;
                    return typeof obj.str === "string" ? obj.str : "";
                })
                .join(" ");
            pages.push(text);
        } catch (error) {
            logger.warn(
                { error, page: i },
                "Failed to extract text from PDF page, continuing"
            );
        }
    }

    return pages.join("\n\n");
}

export const kbService = {
    async createKB(
        data: { name: string; description?: string },
        workspaceId: string
    ) {
        return kbRepository.createKB({ ...data, workspaceId });
    },

    async getKBs(workspaceId: string) {
        return kbRepository.findKBsByWorkspace(workspaceId);
    },

    async getKB(id: string, workspaceId: string) {
        const kb = await kbRepository.findKBById(id, workspaceId);
        if (!kb) throw new NotFoundError("Knowledge base not found");
        return kb;
    },

    async updateKB(
        id: string,
        workspaceId: string,
        data: Partial<{ name: string; description: string }>
    ) {
        const kb = await kbRepository.findKBById(id, workspaceId);
        if (!kb) throw new NotFoundError("Knowledge base not found");
        return kbRepository.updateKB(id, workspaceId, data);
    },

    async deleteKB(id: string, workspaceId: string) {
        const kb = await kbRepository.findKBById(id, workspaceId);
        if (!kb) throw new NotFoundError("Knowledge base not found");
        await kbRepository.deleteKB(id, workspaceId);
    },

    async uploadDocument(
        file: { filename: string; buffer: Buffer; mimetype: string },
        kbId: string,
        workspaceId: string
    ) {
        // Validate KB exists
        const kb = await kbRepository.findKBById(kbId, workspaceId);
        if (!kb) throw new NotFoundError("Knowledge base not found");

        // Check credits before upload
        const creditCheck = await checkCredits(
            workspaceId,
            BASE_CREDIT_COSTS.KB_DOCUMENT_UPLOAD
        );
        if (!creditCheck.allowed) {
            throw new AppError(
                "Insufficient credits to upload document.",
                402,
                "INSUFFICIENT_CREDITS"
            );
        }

        // Validate file size
        if (file.buffer.length > MAX_FILE_SIZE) {
            throw new AppError(
                "File too large. Maximum size is 10MB.",
                400,
                "FILE_TOO_LARGE"
            );
        }

        // Validate file type
        const ext = file.filename.toLowerCase().match(/\.[^.]+$/)?.[0] || "";
        if (!ALLOWED_EXTENSIONS.has(ext) && !ALLOWED_TYPES.has(file.mimetype)) {
            throw new AppError(
                "Unsupported file type. Accepted: .txt, .md, .pdf",
                400,
                "UNSUPPORTED_FILE_TYPE"
            );
        }

        // Extract text
        let text: string;
        if (ext === ".pdf" || file.mimetype === "application/pdf") {
            text = await extractTextFromPDF(file.buffer);
        } else {
            text = file.buffer.toString("utf-8");
        }

        if (!text.trim()) {
            throw new AppError(
                "Could not extract any text from the file.",
                400,
                "EMPTY_FILE"
            );
        }

        // Chunk text
        const chunks = chunkText(text);

        // Generate embeddings
        let embeddings: number[][];
        try {
            embeddings = await generateEmbeddings(chunks);
        } catch (error) {
            logger.error({ error }, "Failed to generate embeddings");
            throw new AppError(
                "Failed to generate embeddings. Please try again.",
                500,
                "EMBEDDING_ERROR"
            );
        }

        // Create document record
        const document = await kbRepository.createDocument({
            workspaceId,
            kbId,
            filename: file.filename,
            chunkCount: chunks.length,
        });

        // Insert chunks
        try {
            const chunkRecords = chunks.map((content, i) => ({
                workspaceId,
                kbId,
                documentId: document.id,
                content,
                embedding: embeddings[i],
                metadata: {
                    filename: file.filename,
                    chunkIndex: i,
                    totalChunks: chunks.length,
                },
            }));
            await kbRepository.insertChunks(chunkRecords);
        } catch (error) {
            // Rollback: delete document if chunk insert fails
            logger.error({ error }, "Failed to insert chunks, rolling back document");
            await kbRepository.deleteDocument(document.id, workspaceId);
            throw new AppError(
                "Failed to store document chunks. Please try again.",
                500,
                "CHUNK_INSERT_ERROR"
            );
        }

        // Deduct credits after successful upload (fire-and-forget)
        deductCredits({
            workspaceId,
            amount: BASE_CREDIT_COSTS.KB_DOCUMENT_UPLOAD,
            type: "kb_upload",
            metadata: { kbId, documentId: document.id, filename: file.filename },
        }).catch((err) =>
            logger.warn({ err }, "KB upload credit deduction failed")
        );

        return document;
    },

    async deleteDocument(id: string, _kbId: string, workspaceId: string) {
        // Chunks cascade-deleted via FK
        await kbRepository.deleteDocument(id, workspaceId);
    },

    async getDocuments(kbId: string, workspaceId: string) {
        return kbRepository.findDocumentsByKB(kbId, workspaceId);
    },

    async queryKB(
        kbIds: string[],
        query: string,
        workspaceId: string,
        topK = 5
    ) {
        if (kbIds.length === 0) return [];

        const queryEmbedding = await generateEmbedding(query);
        return kbRepository.searchAcrossKBs(
            workspaceId,
            kbIds,
            queryEmbedding,
            topK
        );
    },

    async getChunksByDocument(documentId: string, workspaceId: string) {
        const doc = await kbRepository.findDocumentById(documentId, workspaceId);
        if (!doc) throw new NotFoundError("Document not found");
        return kbRepository.findChunksByDocument(documentId, workspaceId);
    },

    async getChunksByKB(kbId: string, workspaceId: string) {
        const kb = await kbRepository.findKBById(kbId, workspaceId);
        if (!kb) throw new NotFoundError("Knowledge base not found");
        return kbRepository.findChunksByKB(kbId, workspaceId);
    },

    async updateChunk(id: string, workspaceId: string, newContent: string) {
        const chunk = await kbRepository.findChunkById(id, workspaceId);
        if (!chunk) throw new NotFoundError("Chunk not found");

        const updated = await kbRepository.updateChunk(id, workspaceId, newContent);

        try {
            const embedding = await generateEmbedding(newContent);
            await kbRepository.updateChunkEmbedding(id, embedding);
        } catch (error) {
            logger.error({ error, chunkId: id }, "Failed to re-embed chunk");
            throw new AppError(
                "Failed to re-generate embedding. Content was saved but embedding may be stale.",
                500,
                "EMBEDDING_ERROR"
            );
        }

        return updated;
    },

    async deleteChunk(id: string, workspaceId: string) {
        const chunk = await kbRepository.findChunkById(id, workspaceId);
        if (!chunk) throw new NotFoundError("Chunk not found");

        await kbRepository.deleteChunk(id, workspaceId);
        await kbRepository.updateDocumentChunkCount(chunk.documentId, workspaceId, -1);
    },

    async addManualChunk(
        data: { kbId: string; documentId: string; content: string },
        workspaceId: string
    ) {
        const kb = await kbRepository.findKBById(data.kbId, workspaceId);
        if (!kb) throw new NotFoundError("Knowledge base not found");

        const doc = await kbRepository.findDocumentById(data.documentId, workspaceId);
        if (!doc) throw new NotFoundError("Document not found");

        let embedding: number[];
        try {
            embedding = await generateEmbedding(data.content);
        } catch (error) {
            logger.error({ error }, "Failed to generate embedding for manual chunk");
            throw new AppError(
                "Failed to generate embedding. Please try again.",
                500,
                "EMBEDDING_ERROR"
            );
        }

        const chunk = await kbRepository.insertManualChunk({
            workspaceId,
            kbId: data.kbId,
            documentId: data.documentId,
            content: data.content,
            embedding,
            metadata: {
                source: "manual",
                addedAt: new Date().toISOString(),
            },
        });

        await kbRepository.updateDocumentChunkCount(data.documentId, workspaceId, 1);

        return chunk;
    },
};
