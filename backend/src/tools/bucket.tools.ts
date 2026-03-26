import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { bucketService } from "../services/bucket.service.ts";
import { bucketRepository } from "../repositories/bucket.repository.ts";
import { getStorage } from "../lib/storage.ts";
import { logger } from "../lib/logger.ts";

export function buildBucketTools(config: {
    workspaceId: string;
    agentId: string;
    sessionId?: string;
}): DynamicStructuredTool[] {
    const { workspaceId, agentId, sessionId } = config;

    const bucketSaveFile = new DynamicStructuredTool({
        name: "bucket_save_file",
        description:
            "Save a file to the workspace bucket. Use this to persist any file you create " +
            "(reports, exports, generated documents, data files, etc.). The file will be stored permanently " +
            "and accessible from the Files page. Returns the file ID.\n\n" +
            "Examples:\n" +
            '- filename: "monthly-report.md", content: "# Monthly Report\\n...", encoding: "text"\n' +
            '- filename: "data-export.csv", content: "name,email\\nJohn,john@example.com", encoding: "text"',
        schema: z.object({
            filename: z
                .string()
                .describe(
                    "Filename with extension (e.g. 'report.pdf', 'data.csv', 'summary.md')"
                ),
            content: z
                .string()
                .describe(
                    "File content. For text files, provide the text directly. For binary files, provide base64-encoded content."
                ),
            encoding: z
                .enum(["text", "base64"])
                .default("text")
                .describe("Content encoding: 'text' for plain text, 'base64' for binary"),
            folder: z
                .string()
                .optional()
                .describe(
                    "Folder path (e.g. '/reports/2026'). Defaults to '/agent-output'"
                ),
            description: z
                .string()
                .optional()
                .describe("Brief description of what this file contains"),
        }),
        func: async ({ filename, content, encoding, folder, description }) => {
            try {
                const buffer =
                    encoding === "base64"
                        ? Buffer.from(content, "base64")
                        : Buffer.from(content, "utf-8");

                // Infer MIME type from extension
                const ext = (filename.match(/\.[^.]+$/)?.[0] || "").toLowerCase();
                const mimeMap: Record<string, string> = {
                    ".txt": "text/plain",
                    ".md": "text/markdown",
                    ".csv": "text/csv",
                    ".json": "application/json",
                    ".html": "text/html",
                    ".xml": "application/xml",
                    ".pdf": "application/pdf",
                    ".png": "image/png",
                    ".jpg": "image/jpeg",
                    ".jpeg": "image/jpeg",
                    ".gif": "image/gif",
                    ".webp": "image/webp",
                };
                const mimeType = mimeMap[ext] || "application/octet-stream";

                const file = await bucketService.uploadFile({
                    workspaceId,
                    filename,
                    buffer,
                    mimeType,
                    folder: folder || "/agent-output",
                    source: "agent_generated",
                    agentId,
                    sessionId,
                    metadata: description ? { description } : {},
                });

                return `File saved successfully.\n- ID: ${file.id}\n- Path: ${file.folder}/${file.filename}\n- Size: ${(Number(file.sizeBytes) / 1024).toFixed(1)}KB\n\nThe file is now available in the workspace Files page.`;
            } catch (error) {
                logger.error({ error, filename }, "bucket_save_file failed");
                return `Failed to save file: ${error instanceof Error ? error.message : "Unknown error"}`;
            }
        },
    });

    const bucketReadFile = new DynamicStructuredTool({
        name: "bucket_read_file",
        description:
            "Read a file's content from the workspace bucket by file ID or filename. " +
            "For text files, returns the content directly. For binary files, returns base64-encoded content.",
        schema: z.object({
            fileId: z
                .string()
                .optional()
                .describe("File ID (UUID). Use this if you know the exact ID."),
            filename: z
                .string()
                .optional()
                .describe("Filename to search for. Returns the most recent match."),
        }),
        func: async ({ fileId, filename }) => {
            try {
                let file;
                if (fileId) {
                    file = await bucketRepository.findById(fileId, workspaceId);
                } else if (filename) {
                    file = await bucketRepository.findByFilename(filename, workspaceId);
                } else {
                    return "Please provide either fileId or filename.";
                }

                if (!file) {
                    return `File not found${filename ? `: "${filename}"` : ""}. Use bucket_list_files to see available files.`;
                }

                const storage = getStorage();
                const { buffer } = await storage.get(file.storageKey);

                // Check if text-based
                const textTypes = [
                    "text/",
                    "application/json",
                    "application/xml",
                    "application/javascript",
                ];
                const isText = textTypes.some((t) => file.mimeType.startsWith(t));

                if (isText) {
                    const content = buffer.toString("utf-8");
                    // Truncate very large files
                    if (content.length > 50000) {
                        return `File: ${file.filename} (${file.folder})\nSize: ${(Number(file.sizeBytes) / 1024).toFixed(1)}KB\n\n${content.slice(0, 50000)}\n\n... [truncated — file is ${content.length} characters]`;
                    }
                    return `File: ${file.filename} (${file.folder})\nSize: ${(Number(file.sizeBytes) / 1024).toFixed(1)}KB\n\n${content}`;
                }

                // Binary file — return base64
                return `File: ${file.filename} (${file.folder})\nType: ${file.mimeType}\nSize: ${(Number(file.sizeBytes) / 1024).toFixed(1)}KB\nEncoding: base64\n\n${buffer.toString("base64")}`;
            } catch (error) {
                logger.error({ error, fileId, filename }, "bucket_read_file failed");
                return `Failed to read file: ${error instanceof Error ? error.message : "Unknown error"}`;
            }
        },
    });

    const bucketListFiles = new DynamicStructuredTool({
        name: "bucket_list_files",
        description:
            "List files in the workspace bucket. Shows filenames, sizes, dates, and IDs.",
        schema: z.object({
            folder: z
                .string()
                .optional()
                .describe("Filter by folder path (e.g. '/reports')"),
            search: z
                .string()
                .optional()
                .describe("Search filenames"),
        }),
        func: async ({ folder, search }) => {
            try {
                const files = await bucketService.listFiles(workspaceId, {
                    folder,
                    search,
                    limit: 50,
                });

                if (files.length === 0) {
                    return folder
                        ? `No files found in folder "${folder}".`
                        : "No files in the bucket yet.";
                }

                const lines = files.map((f) => {
                    const size = (Number(f.sizeBytes) / 1024).toFixed(1);
                    const date = new Date(f.createdAt).toLocaleDateString();
                    return `- ${f.filename} | ${size}KB | ${f.folder} | ${f.source} | ${date} | ID: ${f.id}`;
                });

                return `Files (${files.length}):\n${lines.join("\n")}`;
            } catch (error) {
                logger.error({ error }, "bucket_list_files failed");
                return `Failed to list files: ${error instanceof Error ? error.message : "Unknown error"}`;
            }
        },
    });

    const bucketDeleteFile = new DynamicStructuredTool({
        name: "bucket_delete_file",
        description:
            "Delete a file from the workspace bucket. This is permanent and cannot be undone.",
        schema: z.object({
            fileId: z.string().describe("ID of the file to delete"),
        }),
        func: async ({ fileId }) => {
            try {
                const file = await bucketService.deleteFile(fileId, workspaceId);
                return `File deleted: "${file.filename}" from ${file.folder}`;
            } catch (error) {
                logger.error({ error, fileId }, "bucket_delete_file failed");
                return `Failed to delete file: ${error instanceof Error ? error.message : "Unknown error"}`;
            }
        },
    });

    const bucketGetDownloadUrl = new DynamicStructuredTool({
        name: "bucket_get_download_url",
        description:
            "Get a download URL for a file in the bucket. Use this when you need to share " +
            "a file link with the user or reference it in a message.",
        schema: z.object({
            fileId: z.string().describe("ID of the file"),
        }),
        func: async ({ fileId }) => {
            try {
                const file = await bucketRepository.findById(fileId, workspaceId);
                if (!file) {
                    return `File not found with ID: ${fileId}`;
                }
                // Return a relative download URL — the frontend will prepend the API base
                return `Download URL for "${file.filename}": /api/bucket/files/${file.id}/download\n\nNote: This URL requires authentication. Share the file ID with the user if they need to download it.`;
            } catch (error) {
                logger.error({ error, fileId }, "bucket_get_download_url failed");
                return `Failed to get download URL: ${error instanceof Error ? error.message : "Unknown error"}`;
            }
        },
    });

    return [
        bucketSaveFile,
        bucketReadFile,
        bucketListFiles,
        bucketDeleteFile,
        bucketGetDownloadUrl,
    ];
}
