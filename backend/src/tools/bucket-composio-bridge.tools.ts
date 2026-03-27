import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { bucketRepository } from "../repositories/bucket.repository.ts";
import { getStorage } from "../lib/storage.ts";
import { getComposioClient } from "../lib/composio.ts";
import { logger } from "../lib/logger.ts";

/**
 * Builds a tool that bridges the workspace bucket with Composio external services.
 * This allows the agent to upload bucket files directly to Google Drive, Dropbox, etc.
 * without passing large file content through the LLM context.
 */
export function buildBucketComposioBridgeTool(config: {
    workspaceId: string;
}): DynamicStructuredTool {
    const { workspaceId } = config;

    return new DynamicStructuredTool({
        name: "bucket_export_to_composio",
        description:
            "Upload a file from the workspace bucket directly to an external service (Google Drive, Dropbox, OneDrive, etc.) " +
            "via Composio. This transfers the file server-side without passing its content through the conversation.\n\n" +
            "Use this instead of manually reading the file with bucket_read_file and passing content to COMPOSIO_MULTI_EXECUTE_TOOL.\n\n" +
            "Steps before calling this tool:\n" +
            "1. Use bucket_list_files to find the file ID or know the filename\n" +
            "2. Use COMPOSIO_SEARCH_TOOLS to discover the correct tool slug and its parameter names (e.g. GOOGLEDRIVE_UPLOAD_FILE)\n" +
            "3. Call this tool with the file reference, tool slug, and the parameter name the Composio tool expects for file content\n\n" +
            "Examples:\n" +
            '- Upload to Google Drive: composioToolSlug: "GOOGLEDRIVE_UPLOAD_FILE", fileParamName: "file", additionalParams: { name: "report.pdf", parent: "folder_id" }\n' +
            '- Upload to Dropbox: composioToolSlug: "DROPBOX_UPLOAD_FILE", fileParamName: "file_content", additionalParams: { path: "/reports/report.pdf" }',
        schema: z.object({
            fileId: z
                .string()
                .optional()
                .describe("Bucket file ID (UUID). Use this if you know the exact ID."),
            filename: z
                .string()
                .optional()
                .describe("Bucket filename to search for. Returns the most recent match."),
            composioToolSlug: z
                .string()
                .describe(
                    "The Composio tool slug to execute (e.g. 'GOOGLEDRIVE_UPLOAD_FILE'). " +
                    "Discover this using COMPOSIO_SEARCH_TOOLS first."
                ),
            fileParamName: z
                .string()
                .default("file")
                .describe(
                    "The parameter name the Composio tool expects for the file content (e.g. 'file', 'file_content', 'content'). " +
                    "Check the tool schema from COMPOSIO_SEARCH_TOOLS to find the correct name."
                ),
            additionalParams: z
                .record(z.string(), z.unknown())
                .optional()
                .describe(
                    "Additional parameters to pass to the Composio tool (e.g. folder_id, path, name). " +
                    "These are merged with the file content parameter."
                ),
        }),
        func: async ({ fileId, filename, composioToolSlug, fileParamName, additionalParams }) => {
            try {
                // 1. Resolve the bucket file
                if (!fileId && !filename) {
                    return "Please provide either fileId or filename to identify the bucket file.";
                }

                let file;
                if (fileId) {
                    file = await bucketRepository.findById(fileId, workspaceId);
                } else if (filename) {
                    file = await bucketRepository.findByFilename(filename!, workspaceId);
                }

                if (!file) {
                    return `File not found${filename ? `: "${filename}"` : ""}. Use bucket_list_files to see available files.`;
                }

                // 2. Read file content from storage
                const storage = getStorage();
                const { buffer } = await storage.get(file.storageKey);
                const base64Content = buffer.toString("base64");

                logger.info(
                    { fileId: file.id, filename: file.filename, composioToolSlug, sizeBytes: buffer.length },
                    "bucket_export_to_composio: exporting file"
                );

                // 3. Execute the Composio tool directly (server-side, no LLM context)
                const composio = getComposioClient();
                const toolArguments: Record<string, unknown> = {
                    ...(additionalParams || {}),
                    [fileParamName]: base64Content,
                };

                // Also pass filename/mime if not already in additionalParams
                // Common param names that Composio tools use for filenames
                if (!additionalParams?.name && !additionalParams?.file_name && !additionalParams?.fileName) {
                    toolArguments.name = file.filename;
                }
                if (!additionalParams?.mimeType && !additionalParams?.mime_type && !additionalParams?.content_type) {
                    toolArguments.mimeType = file.mimeType;
                }

                const result = await composio.tools.execute(composioToolSlug, {
                    userId: workspaceId,
                    dangerouslySkipVersionCheck: true,
                    arguments: toolArguments,
                });

                const resultStr = typeof result === "string" ? result : JSON.stringify(result, null, 2);
                return `Successfully exported "${file.filename}" (${(buffer.length / 1024).toFixed(1)}KB) via ${composioToolSlug}.\n\nResult:\n${resultStr}`;
            } catch (error) {
                logger.error({ error, fileId, filename, composioToolSlug }, "bucket_export_to_composio failed");
                const msg = error instanceof Error ? error.message : "Unknown error";
                return `Failed to export file via ${composioToolSlug}: ${msg}\n\nTips:\n- Verify the tool slug is correct (use COMPOSIO_SEARCH_TOOLS to discover it)\n- Check that the integration is connected (use COMPOSIO_MANAGE_CONNECTIONS)\n- Verify the fileParamName matches the tool's schema`;
            }
        },
    });
}
