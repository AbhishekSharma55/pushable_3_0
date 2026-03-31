import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { bucketService } from "../services/bucket.service.ts";
import { bucketRepository } from "../repositories/bucket.repository.ts";
import { getStorage } from "../lib/storage.ts";
import { logger } from "../lib/logger.ts";

const SHARED_FOLDER = "/shared";

export function buildBucketTools(config: {
    workspaceId: string;
    agentId: string;
    sessionId?: string;
    agentFolder?: string;
}): DynamicStructuredTool[] {
    const { workspaceId, agentId, sessionId } = config;
    const agentFolder = config.agentFolder || "/agent-output";
    const allowedFolders = [agentFolder, SHARED_FOLDER];

    /** Check if a folder is writable by this agent */
    function isWritableFolder(folder: string): boolean {
        return folder === agentFolder || folder === SHARED_FOLDER
            || folder.startsWith(agentFolder + "/")
            || folder.startsWith(SHARED_FOLDER + "/");
    }

    /** Resolve the target folder — defaults to agent folder, validates writability */
    function resolveFolder(folder?: string): { folder: string; error?: string } {
        if (!folder) return { folder: agentFolder };
        if (isWritableFolder(folder)) return { folder };
        return {
            folder: agentFolder,
            error: `Cannot write to "${folder}". You can only write to your folder ("${agentFolder}") or "${SHARED_FOLDER}". Saving to "${agentFolder}" instead.`,
        };
    }

    const bucketSaveFile = new DynamicStructuredTool({
        name: "bucket_save_file",
        description:
            "Save a file to the workspace bucket. Use this to persist any file you create " +
            "(reports, exports, generated documents, data files, etc.). The file will be stored permanently " +
            "and accessible from the Files page. Returns the file ID.\n\n" +
            `Your folder: "${agentFolder}" (default)\n` +
            `Shared folder: "${SHARED_FOLDER}" (accessible by all agents)\n\n` +
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
                    `Folder path. Defaults to "${agentFolder}". Use "${SHARED_FOLDER}" to share with other agents. ` +
                    `Supports nested subfolders (e.g. "${agentFolder}/reports/2026", "${SHARED_FOLDER}/exports"). ` +
                    `Folders are created automatically — no need to create them first.`
                ),
            description: z
                .string()
                .optional()
                .describe("Brief description of what this file contains"),
        }),
        func: async ({ filename, content, encoding, folder, description }) => {
            try {
                const resolved = resolveFolder(folder);
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
                    folder: resolved.folder,
                    source: "agent_generated",
                    agentId,
                    sessionId,
                    metadata: description ? { description } : {},
                });

                let result = `File saved successfully.\n- ID: ${file.id}\n- Path: ${file.folder}/${file.filename}\n- Size: ${(Number(file.sizeBytes) / 1024).toFixed(1)}KB\n\nThe file is now available in the workspace Files page.`;
                if (resolved.error) result = `Note: ${resolved.error}\n\n${result}`;
                return result;
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
            "For text files, returns the content directly. For binary files, returns base64-encoded content.\n" +
            `Searches in your folder ("${agentFolder}") and "${SHARED_FOLDER}".`,
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
                    // Verify folder access
                    if (file && !isWritableFolder(file.folder)) {
                        return `Access denied: file "${file.filename}" is in folder "${file.folder}" which is outside your scope. You can access files in "${agentFolder}" and "${SHARED_FOLDER}".`;
                    }
                } else if (filename) {
                    file = await bucketRepository.findByFilename(filename, workspaceId, allowedFolders);
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
            `List files in the workspace bucket. By default shows files in your folder ("${agentFolder}") and "${SHARED_FOLDER}", including any subfolders.`,
        schema: z.object({
            folder: z
                .string()
                .optional()
                .describe(`Filter by specific folder. Leave empty to see your folder + shared.`),
            search: z
                .string()
                .optional()
                .describe("Search filenames"),
        }),
        func: async ({ folder, search }) => {
            try {
                const files = await bucketService.listFiles(workspaceId, {
                    folder: folder || undefined,
                    folders: folder ? undefined : allowedFolders,
                    search,
                    limit: 50,
                });

                if (files.length === 0) {
                    return folder
                        ? `No files found in folder "${folder}".`
                        : `No files in your folder ("${agentFolder}") or "${SHARED_FOLDER}" yet.`;
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
            "Delete a file from the workspace bucket. This is permanent and cannot be undone.\n" +
            `You can only delete files in your folder ("${agentFolder}") or "${SHARED_FOLDER}".`,
        schema: z.object({
            fileId: z.string().describe("ID of the file to delete"),
        }),
        func: async ({ fileId }) => {
            try {
                // Verify folder access before deleting
                const file = await bucketRepository.findById(fileId, workspaceId);
                if (!file) return `File not found with ID: ${fileId}`;
                if (!isWritableFolder(file.folder)) {
                    return `Access denied: cannot delete file in folder "${file.folder}". You can only delete files in "${agentFolder}" or "${SHARED_FOLDER}".`;
                }

                const deleted = await bucketService.deleteFile(fileId, workspaceId);
                return `File deleted: "${deleted.filename}" from ${deleted.folder}`;
            } catch (error) {
                logger.error({ error, fileId }, "bucket_delete_file failed");
                return `Failed to delete file: ${error instanceof Error ? error.message : "Unknown error"}`;
            }
        },
    });

    const bucketUpdateFile = new DynamicStructuredTool({
        name: "bucket_update_file",
        description:
            "Update the content of an existing text file in the bucket (overwrite). " +
            "Use this to update CSV tables, markdown docs, JSON configs, etc. in-place without creating a new file.\n" +
            "Only works for text-based files (txt, md, csv, json, html, xml, etc.).\n\n" +
            `You can only update files in your folder ("${agentFolder}") or "${SHARED_FOLDER}".`,
        schema: z.object({
            fileId: z
                .string()
                .optional()
                .describe("File ID (UUID). Use this if you know the exact ID."),
            filename: z
                .string()
                .optional()
                .describe("Filename to search for. Finds the most recent match in your accessible folders."),
            content: z
                .string()
                .describe("The new full content to write to the file (replaces existing content entirely)."),
        }),
        func: async ({ fileId, filename, content }) => {
            try {
                let file;
                if (fileId) {
                    file = await bucketRepository.findById(fileId, workspaceId);
                    if (file && !isWritableFolder(file.folder)) {
                        return `Access denied: file "${file.filename}" is in folder "${file.folder}" which is outside your scope. You can update files in "${agentFolder}" and "${SHARED_FOLDER}".`;
                    }
                } else if (filename) {
                    file = await bucketRepository.findByFilename(filename, workspaceId, allowedFolders);
                } else {
                    return "Please provide either fileId or filename.";
                }

                if (!file) {
                    return `File not found${filename ? `: "${filename}"` : ""}. Use bucket_save_file to create a new file, or bucket_list_files to see available files.`;
                }

                const updated = await bucketService.updateFileContent(file.id, workspaceId, content);
                if (!updated) {
                    return "Failed to update file: unknown error";
                }
                return `File updated successfully.\n- ID: ${file.id}\n- Path: ${file.folder}/${file.filename}\n- New size: ${(Buffer.from(content, "utf-8").length / 1024).toFixed(1)}KB`;
            } catch (error) {
                logger.error({ error, fileId, filename }, "bucket_update_file failed");
                return `Failed to update file: ${error instanceof Error ? error.message : "Unknown error"}`;
            }
        },
    });

    const bucketGetDownloadUrl = new DynamicStructuredTool({
        name: "bucket_get_download_url",
        description:
            "Get a download URL for a file in the bucket. Use this when you need to share " +
            "a file link with the user or reference it in a message. " +
            "Returns both a relative URL (for frontend use) and an absolute internal URL (for tool-to-tool operations).",
        schema: z.object({
            fileId: z.string().describe("ID of the file"),
        }),
        func: async ({ fileId }) => {
            try {
                const file = await bucketRepository.findById(fileId, workspaceId);
                if (!file) {
                    return `File not found with ID: ${fileId}`;
                }
                const apiPort = process.env.PORT || "4000";
                const apiBase = process.env.API_BASE_URL || `http://localhost:${apiPort}`;
                const relativePath = `/api/bucket/files/${file.id}/download`;
                const absoluteUrl = `${apiBase}${relativePath}`;
                return `Download URL for "${file.filename}":\n- Relative: ${relativePath}\n- Absolute: ${absoluteUrl}\n\nNote: This URL requires authentication (Authorization header + x-workspace-id). Share the file ID with the user if they need to download it.`;
            } catch (error) {
                logger.error({ error, fileId }, "bucket_get_download_url failed");
                return `Failed to get download URL: ${error instanceof Error ? error.message : "Unknown error"}`;
            }
        },
    });

    return [
        bucketSaveFile,
        bucketReadFile,
        bucketUpdateFile,
        bucketListFiles,
        bucketDeleteFile,
        bucketGetDownloadUrl,
    ];
}
