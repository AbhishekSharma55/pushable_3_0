import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { vaultRepository } from "../repositories/vault.repository.ts";
import { encrypt, decrypt } from "../lib/encryption.ts";
import {
    testConnection,
    getCredential,
} from "../services/bitwarden.service.ts";
import { AppError, UnauthorizedError } from "../lib/errors.ts";
import { logger } from "../lib/logger.ts";

const connectSchema = z.object({
    provider: z.literal("bitwarden"),
    clientId: z.string().min(1, "Client ID is required"),
    clientSecret: z.string().min(1, "Client Secret is required"),
    masterPassword: z.string().min(1, "Master Password is required"),
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

    // POST /vault/connect — Save and test Bitwarden credentials
    fastify.post("/vault/connect", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const body = connectSchema.parse(request.body);

        // Test the credentials first
        logger.info({ workspaceId }, "Testing Bitwarden connection");
        const testResult = await testConnection(
            body.clientId,
            body.clientSecret,
            body.masterPassword
        );

        if (!testResult.success) {
            throw new AppError(
                `Bitwarden connection failed: ${testResult.error}`,
                400,
                "VAULT_CONNECTION_FAILED"
            );
        }

        // Delete any existing vault connection for this workspace
        await vaultRepository.deleteByWorkspace(workspaceId);

        // Encrypt and store credentials
        const connection = await vaultRepository.create({
            workspaceId,
            provider: body.provider,
            encryptedClientId: encrypt(body.clientId),
            encryptedClientSecret: encrypt(body.clientSecret),
            encryptedMasterPassword: encrypt(body.masterPassword),
            status: "active",
        });

        logger.info(
            { workspaceId, connectionId: connection.id },
            "Bitwarden vault connected successfully"
        );

        return reply.status(201).send({
            data: {
                id: connection.id,
                provider: connection.provider,
                status: connection.status,
                createdAt: connection.createdAt,
            },
        });
    });

    // GET /vault/status — Get vault connection status
    fastify.get("/vault/status", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const connection = await vaultRepository.findByWorkspace(workspaceId);

        if (!connection) {
            return {
                data: { connected: false, provider: null, status: null },
            };
        }

        return {
            data: {
                connected: true,
                id: connection.id,
                provider: connection.provider,
                status: connection.status,
                createdAt: connection.createdAt,
            },
        };
    });

    // POST /vault/test — Test existing vault connection
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

        const clientId = decrypt(connection.encryptedClientId);
        const clientSecret = decrypt(connection.encryptedClientSecret);
        const masterPassword = decrypt(connection.encryptedMasterPassword);

        const testResult = await testConnection(
            clientId,
            clientSecret,
            masterPassword
        );

        if (!testResult.success) {
            await vaultRepository.updateStatus(connection.id, "failed");
            return { data: { success: false, error: testResult.error } };
        }

        await vaultRepository.updateStatus(connection.id, "active");
        return { data: { success: true } };
    });

    // DELETE /vault/disconnect — Remove vault connection
    fastify.delete("/vault/disconnect", async (request, reply) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        await vaultRepository.deleteByWorkspace(workspaceId);
        logger.info({ workspaceId }, "Vault connection removed");
        return reply.status(204).send();
    });

    // POST /vault/get-credential — Fetch credential by item name
    fastify.post("/vault/get-credential", async (request) => {
        const workspaceId = request.headers["x-workspace-id"] as string;
        const body = getCredentialSchema.parse(request.body);
        const connection = await vaultRepository.findByWorkspace(workspaceId);

        if (!connection || connection.status !== "active") {
            throw new AppError(
                "No active vault connection found",
                404,
                "VAULT_NOT_FOUND"
            );
        }

        const clientId = decrypt(connection.encryptedClientId);
        const clientSecret = decrypt(connection.encryptedClientSecret);
        const masterPassword = decrypt(connection.encryptedMasterPassword);

        const credential = await getCredential(
            clientId,
            clientSecret,
            masterPassword,
            body.itemName
        );

        if (!credential) {
            return {
                data: null,
                message: `No login item found matching "${body.itemName}"`,
            };
        }

        return { data: credential };
    });
}
