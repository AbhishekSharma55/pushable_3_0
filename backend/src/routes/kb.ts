import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { kbService } from "../services/kb.service.ts";
import { AppError, UnauthorizedError } from "../lib/errors.ts";

const createKBSchema = z.object({
    name: z.string().min(1, "Name is required"),
    description: z.string().optional(),
});

const updateKBSchema = z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
});

const chunkContentSchema = z.object({
    content: z.string().min(10, "Content must be at least 10 characters"),
});

export async function kbRoutes(fastify: FastifyInstance) {
    // Auth
    fastify.addHook("onRequest", async (request) => {
        try {
            await request.jwtVerify();
        } catch {
            throw new UnauthorizedError("Invalid or expired token");
        }
    });

    // Validate workspace header
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

    // GET /kb
    fastify.get("/kb", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const kbs = await kbService.getKBs(workspaceId);
        return { data: kbs };
    });

    // POST /kb
    fastify.post("/kb", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const body = createKBSchema.parse(request.body);
        const kb = await kbService.createKB(body, workspaceId);
        return reply.status(201).send({ data: kb });
    });

    // GET /kb/:id
    fastify.get("/kb/:id", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        const kb = await kbService.getKB(id, workspaceId);
        return { data: kb };
    });

    // PUT /kb/:id
    fastify.put("/kb/:id", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        const body = updateKBSchema.parse(request.body);
        const kb = await kbService.updateKB(id, workspaceId, body);
        return { data: kb };
    });

    // DELETE /kb/:id
    fastify.delete("/kb/:id", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };
        await kbService.deleteKB(id, workspaceId);
        return reply.status(204).send();
    });

    // GET /kb/:kbId/documents
    fastify.get("/kb/:kbId/documents", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { kbId } = request.params as { kbId: string };
        const documents = await kbService.getDocuments(kbId, workspaceId);
        return { data: documents };
    });

    // POST /kb/:kbId/documents/upload
    fastify.post("/kb/:kbId/documents/upload", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { kbId } = request.params as { kbId: string };

        const data = await request.file();
        if (!data) {
            throw new AppError("No file uploaded", 400, "NO_FILE");
        }

        const buffer = await data.toBuffer();
        const document = await kbService.uploadDocument(
            {
                filename: data.filename,
                buffer,
                mimetype: data.mimetype,
            },
            kbId,
            workspaceId
        );

        return reply.status(201).send({ data: document });
    });

    // DELETE /kb/:kbId/documents/:id
    fastify.delete("/kb/:kbId/documents/:id", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { kbId, id } = request.params as { kbId: string; id: string };
        await kbService.deleteDocument(id, kbId, workspaceId);
        return reply.status(204).send();
    });

    // GET /kb/:kbId/documents/:documentId/chunks
    fastify.get("/kb/:kbId/documents/:documentId/chunks", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { documentId } = request.params as { kbId: string; documentId: string };
        const chunks = await kbService.getChunksByDocument(documentId, workspaceId);
        return { data: chunks };
    });

    // GET /kb/:kbId/chunks
    fastify.get("/kb/:kbId/chunks", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { kbId } = request.params as { kbId: string };
        const chunks = await kbService.getChunksByKB(kbId, workspaceId);
        return { data: chunks };
    });

    // PUT /kb/chunks/:chunkId
    fastify.put("/kb/chunks/:chunkId", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { chunkId } = request.params as { chunkId: string };
        const body = chunkContentSchema.parse(request.body);
        const chunk = await kbService.updateChunk(chunkId, workspaceId, body.content);
        return { data: chunk };
    });

    // DELETE /kb/chunks/:chunkId
    fastify.delete("/kb/chunks/:chunkId", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { chunkId } = request.params as { chunkId: string };
        await kbService.deleteChunk(chunkId, workspaceId);
        return reply.status(204).send();
    });

    // POST /kb/:kbId/documents/:documentId/chunks
    fastify.post("/kb/:kbId/documents/:documentId/chunks", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { kbId, documentId } = request.params as { kbId: string; documentId: string };
        const body = chunkContentSchema.parse(request.body);
        const chunk = await kbService.addManualChunk(
            { kbId, documentId, content: body.content },
            workspaceId
        );
        return reply.status(201).send({ data: chunk });
    });
}
