import { eq, and } from "drizzle-orm";
import { db } from "../db/client.ts";
import { workspaceInvitations } from "../db/schema/index.ts";

export const invitationRepository = {
    async create(data: {
        workspaceId: string;
        email: string;
        role: "owner" | "admin" | "member";
        invitedBy: string;
        token: string;
        expiresAt: Date;
    }) {
        const result = await db
            .insert(workspaceInvitations)
            .values(data)
            .returning();
        return result[0];
    },

    async findByToken(token: string) {
        const result = await db
            .select()
            .from(workspaceInvitations)
            .where(eq(workspaceInvitations.token, token))
            .limit(1);
        return result[0] ?? null;
    },

    async findByWorkspace(workspaceId: string) {
        return db
            .select()
            .from(workspaceInvitations)
            .where(eq(workspaceInvitations.workspaceId, workspaceId));
    },

    async findPendingByEmail(workspaceId: string, email: string) {
        const result = await db
            .select()
            .from(workspaceInvitations)
            .where(
                and(
                    eq(workspaceInvitations.workspaceId, workspaceId),
                    eq(workspaceInvitations.email, email),
                    eq(workspaceInvitations.status, "pending")
                )
            )
            .limit(1);
        return result[0] ?? null;
    },

    async updateStatus(
        id: string,
        status: "pending" | "accepted" | "expired" | "revoked",
        acceptedAt?: Date
    ) {
        const result = await db
            .update(workspaceInvitations)
            .set({ status, ...(acceptedAt ? { acceptedAt } : {}) })
            .where(eq(workspaceInvitations.id, id))
            .returning();
        return result[0] ?? null;
    },

    async findById(id: string) {
        const result = await db
            .select()
            .from(workspaceInvitations)
            .where(eq(workspaceInvitations.id, id))
            .limit(1);
        return result[0] ?? null;
    },

    async findAllPendingByEmail(email: string) {
        return db
            .select()
            .from(workspaceInvitations)
            .where(
                and(
                    eq(workspaceInvitations.email, email),
                    eq(workspaceInvitations.status, "pending")
                )
            );
    },
};
