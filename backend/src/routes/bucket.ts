import type { FastifyInstance } from "fastify";
import { bucketService } from "../services/bucket.service.ts";
import { AppError, UnauthorizedError } from "../lib/errors.ts";
import { logger } from "../lib/logger.ts";

export async function bucketRoutes(fastify: FastifyInstance) {
    // Auth preHandler
    fastify.addHook("onRequest", async (request) => {
        try {
            await request.jwtVerify();
        } catch {
            throw new UnauthorizedError("Invalid or expired token");
        }
    });

    // Validate x-workspace-id header
    fastify.addHook("preHandler", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        if (!workspaceId) {
            throw new AppError(
                "x-workspace-id header is required",
                400,
                "MISSING_WORKSPACE"
            );
        }
    });

    // ── GET /bucket/files ────────────────────────────────────────────────────
    fastify.get("/bucket/files", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { folder, source, search, limit, offset } = request.query as {
            folder?: string;
            source?: string;
            search?: string;
            limit?: string;
            offset?: string;
        };

        const files = await bucketService.listFiles(workspaceId, {
            folder,
            source,
            search,
            limit: limit ? parseInt(limit, 10) : 100,
            offset: offset ? parseInt(offset, 10) : 0,
        });

        return { data: files };
    });

    // ── GET /bucket/files/:id ────────────────────────────────────────────────
    fastify.get("/bucket/files/:id", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };

        const file = await bucketService.getFile(id, workspaceId);
        return { data: file };
    });

    // ── POST /bucket/files/upload ────────────────────────────────────────────
    fastify.post("/bucket/files/upload", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const user = request.user as { userId: string };

        const parts = request.parts();
        let folder = "/";
        const uploadedFiles: Array<{ id: string; filename: string; folder: string; sizeBytes: number; mimeType: string }> = [];

        for await (const part of parts) {
            if (part.type === "field" && part.fieldname === "folder") {
                folder = part.value as string;
            } else if (part.type === "file") {
                const buffer = await part.toBuffer();
                const file = await bucketService.uploadFile({
                    workspaceId,
                    filename: part.filename,
                    buffer,
                    mimeType: part.mimetype,
                    folder,
                    source: "api_upload",
                    uploadedBy: user.userId,
                });
                uploadedFiles.push({
                    id: file.id,
                    filename: file.filename,
                    folder: file.folder,
                    sizeBytes: Number(file.sizeBytes),
                    mimeType: file.mimeType,
                });
            }
        }

        if (uploadedFiles.length === 0) {
            throw new AppError("No files uploaded", 400, "NO_FILES");
        }

        logger.info(
            { count: uploadedFiles.length, workspaceId },
            "Files uploaded via bucket API"
        );

        return { data: uploadedFiles };
    });

    // ── GET /bucket/files/:id/download ───────────────────────────────────────
    fastify.get("/bucket/files/:id/download", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };

        const { buffer, filename, mimeType } = await bucketService.downloadFile(
            id,
            workspaceId
        );

        return reply
            .header("Content-Type", mimeType)
            .header(
                "Content-Disposition",
                `attachment; filename="${encodeURIComponent(filename)}"`
            )
            .send(buffer);
    });

    // ── DELETE /bucket/files/:id ─────────────────────────────────────────────
    fastify.delete("/bucket/files/:id", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };

        await bucketService.deleteFile(id, workspaceId);
        return { ok: true };
    });

    // ── PUT /bucket/files/:id/content ───────────────────────────────────────
    fastify.put("/bucket/files/:id/content", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        const { content } = request.body as { content: string };

        if (typeof content !== "string") {
            throw new AppError("content must be a string", 400, "INVALID_BODY");
        }

        const updated = await bucketService.updateFileContent(
            id,
            workspaceId,
            content
        );

        return { data: updated };
    });

    // ── PUT /bucket/files/:id ────────────────────────────────────────────────
    fastify.put("/bucket/files/:id", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        const body = request.body as {
            filename?: string;
            folder?: string;
        };

        let updated = null;
        if (body.folder) {
            updated = await bucketService.moveFile(id, workspaceId, body.folder);
        }
        if (body.filename) {
            updated = await bucketService.renameFile(id, workspaceId, body.filename);
        }

        if (!updated) {
            throw new AppError("No changes provided", 400, "NO_CHANGES");
        }

        return { data: updated };
    });

    // ── GET /bucket/folders ──────────────────────────────────────────────────
    fastify.get("/bucket/folders", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const folders = await bucketService.listFolders(workspaceId);
        // Always include root
        const result = Array.from(new Set(["/", ...folders]));
        return { data: result };
    });

    // ── POST /bucket/folders ─────────────────────────────────────────────────
    fastify.post("/bucket/folders", async (request) => {
        const { path } = request.body as { path: string };

        if (!path || !path.startsWith("/")) {
            throw new AppError(
                "Folder path must start with /",
                400,
                "INVALID_FOLDER_PATH"
            );
        }

        // Folders are implicit — they exist when files use them.
        // This endpoint is a no-op but lets the frontend "create" a folder.
        return { data: { path } };
    });

    // ── GET /bucket/usage ────────────────────────────────────────────────────
    fastify.get("/bucket/usage", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const usage = await bucketService.getStorageUsage(workspaceId);
        return { data: usage };
    });
}
