import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { invitationService } from "../services/invitation.service.ts";
import { AppError, UnauthorizedError } from "../lib/errors.ts";
import { invitationRepository } from "../repositories/invitation.repository.ts";
import { userRepository } from "../repositories/user.repository.ts";
import { workspaceRepository } from "../repositories/workspace.repository.ts";

const inviteSchema = z.object({
    email: z.string().email("Valid email is required"),
});

const acceptSchema = z.object({
    token: z.string().min(1, "Token is required"),
});

export async function invitationRoutes(fastify: FastifyInstance) {
    // Auth preHandler for all routes
    fastify.addHook("onRequest", async (request) => {
        try {
            await request.jwtVerify();
        } catch {
            throw new UnauthorizedError("Invalid or expired token");
        }
    });

    // POST /workspaces/:workspaceId/invitations — invite a user
    fastify.post("/workspaces/:workspaceId/invitations", async (request, reply) => {
        const { workspaceId } = request.params as { workspaceId: string };
        const user = request.user as { userId: string };
        const body = inviteSchema.parse(request.body);

        const invitation = await invitationService.inviteUser(
            workspaceId,
            user.userId,
            body.email,
            "member"
        );

        return reply.status(201).send({ data: invitation });
    });

    // GET /workspaces/:workspaceId/invitations — list invitations
    fastify.get("/workspaces/:workspaceId/invitations", async (request) => {
        const { workspaceId } = request.params as { workspaceId: string };
        const user = request.user as { userId: string };

        const invitations = await invitationService.listInvitations(workspaceId, user.userId);
        return { data: invitations };
    });

    // DELETE /workspaces/:workspaceId/invitations/:invitationId — revoke invitation
    fastify.delete("/workspaces/:workspaceId/invitations/:invitationId", async (request) => {
        const { workspaceId, invitationId } = request.params as {
            workspaceId: string;
            invitationId: string;
        };
        const user = request.user as { userId: string };

        await invitationService.revokeInvitation(workspaceId, invitationId, user.userId);
        return { data: { success: true } };
    });

    // POST /invitations/accept — accept an invitation (no workspace header needed)
    fastify.post("/invitations/accept", async (request) => {
        const user = request.user as { userId: string };
        const body = acceptSchema.parse(request.body);

        const result = await invitationService.acceptInvitation(body.token, user.userId);
        return { data: result };
    });

    // GET /invitations/:token — get invitation details (for the accept page)
    fastify.get("/invitations/:token", async (request) => {
        const { token } = request.params as { token: string };
        const details = await invitationService.getInvitationByToken(token);
        return { data: details };
    });

    // GET /invitations/pending/me — get all pending invitations for the current user
    fastify.get("/invitations/pending/me", async (request) => {
        const user = request.user as { userId: string };
        const dbUser = await userRepository.findById(user.userId);
        if (!dbUser) return { data: [] };

        const pending = await invitationRepository.findAllPendingByEmail(dbUser.email);

        // Filter out expired ones and enrich with workspace names
        const now = new Date();
        const valid = [];
        for (const inv of pending) {
            if (new Date(inv.expiresAt) < now) continue;
            const ws = await workspaceRepository.findById(inv.workspaceId);
            valid.push({
                id: inv.id,
                workspaceName: ws?.name || "Unknown workspace",
                email: inv.email,
                role: inv.role,
                token: inv.token,
                expiresAt: inv.expiresAt,
            });
        }
        return { data: valid };
    });
}
