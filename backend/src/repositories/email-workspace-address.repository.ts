import { eq, and } from "drizzle-orm";
import { db } from "../db/client.ts";
import { emailWorkspaceAddresses } from "../db/schema/index.ts";

export const emailWorkspaceAddressRepository = {
    async create(data: {
        workspaceId: string;
        address: string;
        displayName?: string;
        customInstructions?: string;
    }) {
        const result = await db
            .insert(emailWorkspaceAddresses)
            .values(data)
            .returning();
        return result[0];
    },

    async findByAddress(address: string) {
        const result = await db
            .select()
            .from(emailWorkspaceAddresses)
            .where(eq(emailWorkspaceAddresses.address, address.toLowerCase()))
            .limit(1);
        return result[0] ?? null;
    },

    async findByWorkspace(workspaceId: string) {
        const result = await db
            .select()
            .from(emailWorkspaceAddresses)
            .where(eq(emailWorkspaceAddresses.workspaceId, workspaceId))
            .limit(1);
        return result[0] ?? null;
    },

    async update(
        id: string,
        workspaceId: string,
        data: Partial<{
            address: string;
            displayName: string | null;
            customInstructions: string | null;
            enabled: boolean;
        }>
    ) {
        const result = await db
            .update(emailWorkspaceAddresses)
            .set({ ...data, updatedAt: new Date() })
            .where(
                and(
                    eq(emailWorkspaceAddresses.id, id),
                    eq(emailWorkspaceAddresses.workspaceId, workspaceId)
                )
            )
            .returning();
        return result[0] ?? null;
    },

    async delete(id: string, workspaceId: string) {
        await db
            .delete(emailWorkspaceAddresses)
            .where(
                and(
                    eq(emailWorkspaceAddresses.id, id),
                    eq(emailWorkspaceAddresses.workspaceId, workspaceId)
                )
            );
    },
};
