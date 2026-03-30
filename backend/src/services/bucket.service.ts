import { bucketRepository } from "../repositories/bucket.repository.ts";
import { getStorage, generateStorageKey } from "../lib/storage.ts";
import { logger } from "../lib/logger.ts";
import { AppError } from "../lib/errors.ts";

const MAX_STORAGE_BYTES =
    (parseInt(process.env.MAX_BUCKET_STORAGE_MB || "500", 10)) * 1024 * 1024;

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB per file

const BLOCKED_EXTENSIONS = new Set([
    ".exe", ".bat", ".cmd", ".sh", ".ps1", ".msi", ".dll", ".so", ".dylib",
]);

function sanitizeFolder(folder: string): string {
    let clean = folder.replace(/\.\./g, "").replace(/\/+/g, "/");
    if (!clean.startsWith("/")) clean = "/" + clean;
    if (clean.length > 1 && clean.endsWith("/")) clean = clean.slice(0, -1);
    return clean;
}

export const bucketService = {
    async uploadFile(data: {
        workspaceId: string;
        filename: string;
        buffer: Buffer;
        mimeType: string;
        folder?: string;
        source: "chat_upload" | "agent_generated" | "api_upload";
        sessionId?: string;
        agentId?: string;
        uploadedBy?: string;
        metadata?: Record<string, unknown>;
    }) {
        const { workspaceId, filename, buffer, mimeType, source, sessionId, agentId, uploadedBy, metadata } = data;
        const folder = sanitizeFolder(data.folder || "/");

        // Validate file size
        if (buffer.length > MAX_FILE_SIZE) {
            throw new AppError(
                `File "${filename}" exceeds maximum size of ${MAX_FILE_SIZE / (1024 * 1024)}MB`,
                400,
                "FILE_TOO_LARGE"
            );
        }

        // Block dangerous extensions
        const ext = (filename.match(/\.[^.]+$/)?.[0] || "").toLowerCase();
        if (BLOCKED_EXTENSIONS.has(ext)) {
            throw new AppError(
                `File type "${ext}" is not allowed`,
                400,
                "BLOCKED_FILE_TYPE"
            );
        }

        // Check workspace storage limit
        const usage = await bucketRepository.getStorageUsage(workspaceId);
        if (usage.totalBytes + buffer.length > MAX_STORAGE_BYTES) {
            throw new AppError(
                `Storage limit exceeded. Used: ${(usage.totalBytes / (1024 * 1024)).toFixed(1)}MB / ${MAX_STORAGE_BYTES / (1024 * 1024)}MB`,
                400,
                "STORAGE_LIMIT_EXCEEDED"
            );
        }

        // Check for duplicate filename in the same folder
        const existing = await bucketRepository.findByFilename(filename, workspaceId, [folder]);
        if (existing) {
            throw new AppError(
                `File "${filename}" already exists in folder "${folder}". Use a different name, or delete/update the existing file.`,
                409,
                "DUPLICATE_FILENAME"
            );
        }

        // Generate storage key and write to disk
        const storageKey = generateStorageKey(workspaceId, filename);
        const storage = getStorage();
        await storage.put(storageKey, buffer, mimeType);

        // Create database record
        try {
            const file = await bucketRepository.createFile({
                workspaceId,
                filename,
                storageKey,
                mimeType,
                sizeBytes: buffer.length,
                folder,
                source,
                sessionId,
                agentId,
                uploadedBy,
                metadata,
            });

            logger.info(
                { fileId: file.id, filename, folder, source, size: buffer.length },
                "File uploaded to bucket"
            );

            return file;
        } catch (err) {
            // Cleanup disk file if DB insert fails
            await storage.delete(storageKey).catch(() => {});
            throw err;
        }
    },

    async getFile(id: string, workspaceId: string) {
        const file = await bucketRepository.findById(id, workspaceId);
        if (!file) {
            throw new AppError("File not found", 404, "FILE_NOT_FOUND");
        }
        return file;
    },

    async downloadFile(id: string, workspaceId: string) {
        const file = await this.getFile(id, workspaceId);
        const storage = getStorage();
        const { buffer } = await storage.get(file.storageKey);
        return { buffer, filename: file.filename, mimeType: file.mimeType };
    },

    async deleteFile(id: string, workspaceId: string) {
        const file = await bucketRepository.deleteFile(id, workspaceId);
        if (!file) {
            throw new AppError("File not found", 404, "FILE_NOT_FOUND");
        }

        // Delete from disk
        const storage = getStorage();
        await storage.delete(file.storageKey).catch((err) => {
            logger.warn({ err, storageKey: file.storageKey }, "Failed to delete file from disk");
        });

        logger.info({ fileId: id, filename: file.filename }, "File deleted from bucket");
        return file;
    },

    async listFiles(
        workspaceId: string,
        options?: {
            folder?: string;
            folders?: string[];
            source?: string;
            search?: string;
            limit?: number;
            offset?: number;
        }
    ) {
        return bucketRepository.findByWorkspace(workspaceId, options);
    },

    async moveFile(id: string, workspaceId: string, newFolder: string) {
        const folder = sanitizeFolder(newFolder);
        return bucketRepository.updateFile(id, workspaceId, { folder });
    },

    async renameFile(id: string, workspaceId: string, newFilename: string) {
        return bucketRepository.updateFile(id, workspaceId, { filename: newFilename });
    },

    async updateFileContent(id: string, workspaceId: string, content: string) {
        const file = await this.getFile(id, workspaceId);

        // Only allow text-based file edits
        const editable =
            file.mimeType.startsWith("text/") ||
            [
                "application/json",
                "application/xml",
                "application/javascript",
                "application/xhtml+xml",
            ].includes(file.mimeType);

        if (!editable) {
            throw new AppError(
                "This file type cannot be edited",
                400,
                "FILE_NOT_EDITABLE"
            );
        }

        const buffer = Buffer.from(content, "utf-8");

        if (buffer.length > MAX_FILE_SIZE) {
            throw new AppError(
                `Content exceeds maximum size of ${MAX_FILE_SIZE / (1024 * 1024)}MB`,
                400,
                "FILE_TOO_LARGE"
            );
        }

        // Overwrite file on disk
        const storage = getStorage();
        await storage.put(file.storageKey, buffer, file.mimeType);

        // Update size in DB
        const updated = await bucketRepository.updateFile(id, workspaceId, {
            sizeBytes: buffer.length,
        });

        logger.info(
            { fileId: id, filename: file.filename, newSize: buffer.length },
            "File content updated"
        );

        return updated;
    },

    async getStorageUsage(workspaceId: string) {
        const usage = await bucketRepository.getStorageUsage(workspaceId);
        return {
            ...usage,
            limitBytes: MAX_STORAGE_BYTES,
            usedPercent: Math.round((usage.totalBytes / MAX_STORAGE_BYTES) * 100),
        };
    },

    async listFolders(workspaceId: string) {
        return bucketRepository.listFolders(workspaceId);
    },

    async findByFilename(filename: string, workspaceId: string) {
        return bucketRepository.findByFilename(filename, workspaceId);
    },
};
