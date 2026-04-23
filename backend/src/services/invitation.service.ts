import { randomUUID } from "crypto";
import { invitationRepository } from "../repositories/invitation.repository.ts";
import { workspaceRepository } from "../repositories/workspace.repository.ts";
import { userRepository } from "../repositories/user.repository.ts";
import { requireOwnerOrAdmin } from "../lib/authorization.ts";
import { AppError, ConflictError, NotFoundError, ForbiddenError } from "../lib/errors.ts";
import { sendMail, buildInvitationEmail } from "../lib/mailer.ts";
import { logger } from "../lib/logger.ts";

const INVITE_EXPIRY_DAYS = 7;

export const invitationService = {
    async inviteUser(
        workspaceId: string,
        invitedBy: string,
        email: string,
        role: "admin" | "member" = "member"
    ) {
        // Verify inviter is owner or admin
        await requireOwnerOrAdmin(workspaceId, invitedBy);

        // Check target is not already a member
        const existingUser = await userRepository.findByEmail(email);
        if (existingUser) {
            const isMember = await workspaceRepository.isMember(workspaceId, existingUser.id);
            if (isMember) {
                throw new ConflictError("This user is already a member of the workspace");
            }
        }

        // Check no pending invite exists
        const pendingInvite = await invitationRepository.findPendingByEmail(workspaceId, email);
        if (pendingInvite) {
            throw new ConflictError(
                "A pending invitation already exists for this email. Revoke it first to send a new one."
            );
        }

        const token = randomUUID();
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + INVITE_EXPIRY_DAYS);

        const invitation = await invitationRepository.create({
            workspaceId,
            email,
            role,
            invitedBy,
            token,
            expiresAt,
        });

        // Send invitation email
        try {
            const workspace = await workspaceRepository.findById(workspaceId);
            const inviter = await userRepository.findById(invitedBy);
            const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
            const inviteLink = `${frontendUrl}/invite/${token}`;

            await sendMail({
                to: email,
                subject: `You've been invited to join ${workspace?.name || "a workspace"} on Pushable`,
                html: buildInvitationEmail(
                    workspace?.name || "a workspace",
                    inviter?.name || "A team member",
                    role,
                    inviteLink
                ),
            });
        } catch (err) {
            logger.warn({ err, email }, "Failed to send invitation email, but invitation was created");
        }

        return invitation;
    },

    async acceptInvitation(token: string, userId: string) {
        const invitation = await invitationRepository.findByToken(token);
        if (!invitation) {
            throw new NotFoundError("Invitation not found");
        }

        if (invitation.status !== "pending") {
            throw new AppError(
                `This invitation has already been ${invitation.status}`,
                400,
                "INVITATION_NOT_PENDING"
            );
        }

        if (new Date() > invitation.expiresAt) {
            await invitationRepository.updateStatus(invitation.id, "expired");
            throw new AppError(
                "This invitation has expired. Please request a new one.",
                400,
                "INVITATION_EXPIRED"
            );
        }

        // Verify email match
        const user = await userRepository.findById(userId);
        if (!user) {
            throw new NotFoundError("User not found");
        }

        if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
            throw new ForbiddenError(
                "This invitation was sent to a different email address"
            );
        }

        // Check not already a member
        const isMember = await workspaceRepository.isMember(invitation.workspaceId, userId);
        if (isMember) {
            // Mark invitation as accepted anyway
            await invitationRepository.updateStatus(invitation.id, "accepted", new Date());
            const workspace = await workspaceRepository.findById(invitation.workspaceId);
            return { workspace, alreadyMember: true };
        }

        // Add user as workspace member
        await workspaceRepository.addMember({
            workspaceId: invitation.workspaceId,
            userId,
            role: invitation.role === "owner" ? "member" : invitation.role,
        });

        // Mark invitation as accepted
        await invitationRepository.updateStatus(invitation.id, "accepted", new Date());

        const workspace = await workspaceRepository.findById(invitation.workspaceId);
        return { workspace, alreadyMember: false };
    },

    async revokeInvitation(workspaceId: string, invitationId: string, userId: string) {
        await requireOwnerOrAdmin(workspaceId, userId);

        const invitation = await invitationRepository.findById(invitationId);
        if (!invitation || invitation.workspaceId !== workspaceId) {
            throw new NotFoundError("Invitation not found");
        }

        if (invitation.status !== "pending") {
            throw new AppError(
                "Only pending invitations can be revoked",
                400,
                "INVITATION_NOT_PENDING"
            );
        }

        return invitationRepository.updateStatus(invitationId, "revoked");
    },

    async listInvitations(workspaceId: string, userId: string) {
        await requireOwnerOrAdmin(workspaceId, userId);
        return invitationRepository.findByWorkspace(workspaceId);
    },

    async getInvitationByToken(token: string) {
        const invitation = await invitationRepository.findByToken(token);
        if (!invitation) {
            throw new NotFoundError("Invitation not found");
        }

        const workspace = await workspaceRepository.findById(invitation.workspaceId);
        return {
            id: invitation.id,
            workspaceName: workspace?.name || "Unknown workspace",
            email: invitation.email,
            role: invitation.role,
            status: invitation.status,
            expiresAt: invitation.expiresAt,
        };
    },
};
