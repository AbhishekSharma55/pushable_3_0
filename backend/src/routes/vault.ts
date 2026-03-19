import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { vaultRepository } from "../repositories/vault.repository.ts";
import {
    connectVault,
    saveConnection,
    testConnection,
    getCredential,
    disconnectVault,
} from "../services/bitwarden.service.ts";
import { AppError, UnauthorizedError } from "../lib/errors.ts";
import { logger } from "../lib/logger.ts";

const connectSchema = z.object({
    provider: z.literal("bitwarden"),
    email: z.string().email("A valid email address is required"),
    masterPassword: z.string().min(1, "Master Password is required"),
    verificationCode: z.string().optional(),
});

const getCredentialSchema = z.object({
    itemName: z.string().min(1, "Item name is required"),
});

export async function vaultRoutes(fastify: FastifyInstance) {
    // JWT auth hook
    fastify.addHook("onRequest", async (request) => {
        try {
            await request.jwtVerify();
        } catch {
            throw new UnauthorizedError("Invalid or expired token");
        }
    });

    // Workspace header required for all vault routes
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

    // POST /vault/connect
    fastify.post("/vault/connect", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const body = connectSchema.parse(request.body);

        logger.info(
            { workspaceId, email: body.email },
            "Connecting Bitwarden vault via CLI"
        );

        let result;
        try {
            result = await connectVault(
                body.email,
                body.masterPassword,
                workspaceId,
                body.verificationCode
            );
        } catch (error: unknown) {
            const message =
                error instanceof Error
                    ? error.message
                    : "Bitwarden connection failed";
            const errorCode = (error as any)?.code || "VAULT_CONNECTION_FAILED";

            await vaultRepository.logAudit({
                workspaceId,
                action: "connect",
                success: false,
                errorMessage: message,
            });
            throw new AppError(message, 400, errorCode);
        }

        // Store session key in DB
        const connection = await saveConnection(
            workspaceId,
            result.sessionKey,
            result.email
        );

        await vaultRepository.logAudit({
            workspaceId,
            connectionId: connection.id,
            action: "connect",
            success: true,
        });

        logger.info(
            { workspaceId, connectionId: connection.id },
            "Bitwarden vault connected via CLI"
        );

        return reply.status(201).send({
            data: {
                id: connection.id,
                provider: connection.provider,
                status: connection.status,
                email: connection.email,
                createdAt: connection.createdAt,
            },
        });
    });

    // GET /vault/status
    fastify.get("/vault/status", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const connection = await vaultRepository.findByWorkspace(workspaceId);

        if (!connection) {
            return {
                data: {
                    connected: false,
                    provider: null,
                    status: null,
                    email: null,
                },
            };
        }

        return {
            data: {
                connected: true,
                id: connection.id,
                provider: connection.provider,
                status: connection.status,
                email: connection.email,
                tokenExpiresAt: connection.tokenExpiresAt,
                createdAt: connection.createdAt,
            },
        };
    });

    // POST /vault/test
    fastify.post("/vault/test", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const connection = await vaultRepository.findByWorkspace(workspaceId);

        if (!connection) {
            throw new AppError(
                "No vault connection found",
                404,
                "VAULT_NOT_FOUND"
            );
        }

        const result = await testConnection(workspaceId);
        return { data: result };
    });

    // DELETE /vault/disconnect
    fastify.delete("/vault/disconnect", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        await disconnectVault(workspaceId);
        logger.info({ workspaceId }, "Vault connection removed");
        return reply.status(204).send();
    });

    // POST /vault/get-credential
    fastify.post("/vault/get-credential", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const body = getCredentialSchema.parse(request.body);

        const credential = await getCredential(workspaceId, body.itemName);

        if (!credential) {
            return {
                data: null,
                message: `No login item found matching "${body.itemName}"`,
            };
        }

        return { data: credential };
    });
}
