import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { emailWorkspaceAddressRepository } from "../repositories/email-workspace-address.repository.ts";
import { emailApprovedSenderRepository } from "../repositories/email-approved-sender.repository.ts";
import { inboundEmailRepository } from "../repositories/inbound-email.repository.ts";
import { resolveChannelApproval } from "../channels/message-router.ts";
import { channelManager } from "../channels/channel-manager.ts";
import { AppError, UnauthorizedError } from "../lib/errors.ts";

const createAddressSchema = z.object({
    address: z.string().email("Must be a valid email address"),
    displayName: z.string().optional(),
    customInstructions: z.string().optional(),
});

const updateAddressSchema = z.object({
    address: z.string().email().optional(),
    displayName: z.string().nullable().optional(),
    customInstructions: z.string().nullable().optional(),
    enabled: z.boolean().optional(),
});

const createSenderSchema = z.object({
    senderPattern: z.string().min(1, "Sender pattern is required"),
    note: z.string().optional(),
});

const simulateEmailSchema = z.object({
    from: z.string().email(),
    to: z.string().email(),
    subject: z.string(),
    body: z.string(),
    fromName: z.string().optional(),
});

export async function emailRoutes(fastify: FastifyInstance) {
    fastify.addHook("onRequest", async (request) => {
        // Skip auth for simulate endpoint in non-production
        const url = request.url;
        if (url.endsWith("/email/simulate") && process.env.NODE_ENV !== "production") {
            return;
        }
        try {
            await request.jwtVerify();
        } catch {
            throw new UnauthorizedError("Invalid or expired token");
        }
    });

    fastify.addHook("preHandler", async (request) => {
        const url = request.url;
        if (url.endsWith("/email/simulate") && process.env.NODE_ENV !== "production") {
            return;
        }
        const workspaceId = request.headers["x-workspace-id"] as string;
        if (!workspaceId) {
            throw new AppError("x-workspace-id header is required", 400, "MISSING_WORKSPACE");
        }
    });

    // ==========================================
    // Workspace Email Address (singular — one per workspace)
    // ==========================================

    // GET /email/address
    fastify.get("/email/address", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const address = await emailWorkspaceAddressRepository.findByWorkspace(workspaceId);
        return { data: address };
    });

    // POST /email/address
    fastify.post("/email/address", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const body = createAddressSchema.parse(request.body);

        // Check if workspace already has an email address
        const existing = await emailWorkspaceAddressRepository.findByWorkspace(workspaceId);
        if (existing) {
            throw new AppError(
                "Workspace already has an email address configured. Use PUT to update.",
                409,
                "EMAIL_ADDRESS_EXISTS"
            );
        }

        const address = await emailWorkspaceAddressRepository.create({
            workspaceId,
            address: body.address.toLowerCase(),
            displayName: body.displayName,
            customInstructions: body.customInstructions,
        });
        return reply.status(201).send({ data: address });
    });

    // PUT /email/address
    fastify.put("/email/address", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const body = updateAddressSchema.parse(request.body);

        const existing = await emailWorkspaceAddressRepository.findByWorkspace(workspaceId);
        if (!existing) {
            throw new AppError("No email address configured", 404, "EMAIL_ADDRESS_NOT_FOUND");
        }

        const updated = await emailWorkspaceAddressRepository.update(
            existing.id,
            workspaceId,
            {
                ...body,
                address: body.address?.toLowerCase(),
            }
        );
        return { data: updated };
    });

    // DELETE /email/address
    fastify.delete("/email/address", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;

        const existing = await emailWorkspaceAddressRepository.findByWorkspace(workspaceId);
        if (!existing) {
            throw new AppError("No email address configured", 404, "EMAIL_ADDRESS_NOT_FOUND");
        }

        await emailWorkspaceAddressRepository.delete(existing.id, workspaceId);
        return { success: true };
    });

    // POST /email/address/generate — auto-generate an email address for workspaces that don't have one
    fastify.post("/email/address/generate", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;

        const existing = await emailWorkspaceAddressRepository.findByWorkspace(workspaceId);
        if (existing) {
            return { data: existing };
        }

        const domain = process.env.EMAIL_DOMAIN || "pushable.ai";
        const randomSuffix = Math.random().toString(36).substring(2, 8);
        const address = `workspace-${randomSuffix}@${domain}`;

        const created = await emailWorkspaceAddressRepository.create({
            workspaceId,
            address,
        });
        return reply.status(201).send({ data: created });
    });

    // POST /email/address/regenerate — generate a new unique email address for the workspace
    fastify.post("/email/address/regenerate", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;

        const existing = await emailWorkspaceAddressRepository.findByWorkspace(workspaceId);
        if (!existing) {
            throw new AppError("No email address configured", 404, "EMAIL_ADDRESS_NOT_FOUND");
        }

        const domain = process.env.EMAIL_DOMAIN || "pushable.ai";
        const randomSuffix = Math.random().toString(36).substring(2, 8);
        // Keep base prefix (strip old random suffix) and append new one, always use current domain
        const basePrefix = existing.address.split("@")[0].replace(/-[a-z0-9]{4,8}$/, "");
        const newAddress = `${basePrefix}-${randomSuffix}@${domain}`;

        const updated = await emailWorkspaceAddressRepository.update(
            existing.id,
            workspaceId,
            { address: newAddress }
        );
        return { data: updated };
    });

    // ==========================================
    // Approved Senders
    // ==========================================

    // GET /email/approved-senders
    fastify.get("/email/approved-senders", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const senders = await emailApprovedSenderRepository.findByWorkspace(workspaceId);
        return { data: senders };
    });

    // POST /email/approved-senders
    fastify.post("/email/approved-senders", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const body = createSenderSchema.parse(request.body);

        const sender = await emailApprovedSenderRepository.create({
            workspaceId,
            senderPattern: body.senderPattern.toLowerCase(),
            note: body.note,
        });
        return reply.status(201).send({ data: sender });
    });

    // DELETE /email/approved-senders/:id
    fastify.delete("/email/approved-senders/:id", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };

        await emailApprovedSenderRepository.delete(id, workspaceId);
        return { success: true };
    });

    // ==========================================
    // Inbox
    // ==========================================

    // GET /email/inbox
    fastify.get("/email/inbox", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const query = request.query as {
            status?: string;
            page?: string;
            limit?: string;
        };

        const status = query.status as
            | "received"
            | "routing"
            | "processing"
            | "awaiting_approval"
            | "approved"
            | "rejected"
            | "completed"
            | "failed"
            | "spam"
            | undefined;
        const page = Math.max(1, parseInt(query.page || "1", 10));
        const limit = Math.min(100, Math.max(1, parseInt(query.limit || "50", 10)));
        const offset = (page - 1) * limit;

        const [emails, total] = await Promise.all([
            inboundEmailRepository.findByWorkspace(workspaceId, { status, limit, offset }),
            inboundEmailRepository.countByWorkspace(workspaceId, status),
        ]);

        return {
            data: emails,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    });

    // GET /email/inbox/:id
    fastify.get("/email/inbox/:id", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };

        const email = await inboundEmailRepository.findById(id, workspaceId);
        if (!email) {
            throw new AppError("Email not found", 404, "EMAIL_NOT_FOUND");
        }

        return { data: email };
    });

    // POST /email/inbox/:id/approve
    fastify.post("/email/inbox/:id/approve", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };

        const email = await inboundEmailRepository.findById(id, workspaceId);
        if (!email) {
            throw new AppError("Email not found", 404, "EMAIL_NOT_FOUND");
        }
        if (email.status !== "awaiting_approval") {
            throw new AppError("Email is not awaiting approval", 400, "INVALID_STATUS");
        }

        await inboundEmailRepository.updateStatus(id, "approved", "Approved by user");

        // Resume the LangGraph execution if there's a session
        if (email.sessionId) {
            const result = await resolveChannelApproval(email.sessionId, "approve");
            if (result?.content) {
                await inboundEmailRepository.updateStatus(
                    id,
                    "completed",
                    "Approval processed and agent completed task"
                );
            }
        }

        return { success: true };
    });

    // POST /email/inbox/:id/reject
    fastify.post("/email/inbox/:id/reject", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id } = request.params as { id: string };

        const email = await inboundEmailRepository.findById(id, workspaceId);
        if (!email) {
            throw new AppError("Email not found", 404, "EMAIL_NOT_FOUND");
        }
        if (email.status !== "awaiting_approval") {
            throw new AppError("Email is not awaiting approval", 400, "INVALID_STATUS");
        }

        await inboundEmailRepository.updateStatus(id, "rejected", "Rejected by user");

        // Resume the LangGraph execution with rejection
        if (email.sessionId) {
            await resolveChannelApproval(email.sessionId, "reject");
        }

        return { success: true };
    });

    // GET /email/inbox/:id/attachment/:index — serve attachment file from storage
    fastify.get("/email/inbox/:id/attachment/:index", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const { id, index } = request.params as { id: string; index: string };

        const email = await inboundEmailRepository.findById(id, workspaceId);
        if (!email) {
            throw new AppError("Email not found", 404, "EMAIL_NOT_FOUND");
        }

        const attachments = (email.attachments as Array<{
            filename: string; mimeType: string; size: number; storageKey: string;
        }>) || [];
        const idx = parseInt(index, 10);
        const attachment = attachments[idx];
        if (!attachment) {
            throw new AppError("Attachment not found", 404, "ATTACHMENT_NOT_FOUND");
        }

        const { getStorage } = await import("../lib/storage.ts");
        const storage = getStorage();
        const { buffer, contentType } = await storage.get(attachment.storageKey);

        reply
            .header("Content-Type", contentType)
            .header("Content-Disposition", `inline; filename="${attachment.filename}"`)
            .header("Content-Length", buffer.length)
            .send(buffer);
    });

    // ==========================================
    // Local Testing (non-production only)
    // ==========================================

    // POST /email/simulate
    fastify.post("/email/simulate", async (request, reply) => {
        if (process.env.NODE_ENV === "production") {
            return reply.status(404).send();
        }

        const body = simulateEmailSchema.parse(request.body);

        const handler = channelManager.getPlatformEmailHandler();
        if (!handler) {
            throw new AppError(
                "Email handler not initialized. Set EMAIL_DOMAIN env var.",
                503,
                "EMAIL_NOT_CONFIGURED"
            );
        }

        // Simulate a Cloudflare Email Routing payload
        const simulatedPayload = {
            from: body.fromName
                ? `${body.fromName} <${body.from}>`
                : body.from,
            to: body.to,
            subject: body.subject,
            text: body.body,
            html: `<p>${body.body}</p>`,
            headers: {
                "message-id": `<sim-${Date.now()}@local>`,
            },
        };

        // Fire-and-forget processing
        handler
            .handleInboundEmail(simulatedPayload)
            .catch((err) => {
                fastify.log.error({ err }, "Simulated email processing failed");
            });

        return { ok: true, message: "Email simulation triggered" };
    });
}
