import { eq, and } from "drizzle-orm";
import { db } from "../db/client.ts";
import { emailWorkflowAddresses } from "../db/schema/index.ts";

export const emailWorkflowAddressRepository = {
    async create(data: {
        workspaceId: string;
        emailAddressId: string;
        suffix: string;
        fullAddress: string;
        instructions: string;
    }) {
        const result = await db
            .insert(emailWorkflowAddresses)
            .values(data)
            .returning();
        return result[0];
    },

    async findByWorkspace(workspaceId: string) {
        return db
            .select()
            .from(emailWorkflowAddresses)
            .where(eq(emailWorkflowAddresses.workspaceId, workspaceId))
            .orderBy(emailWorkflowAddresses.createdAt);
    },

    async findByFullAddress(fullAddress: string) {
        const result = await db
            .select()
            .from(emailWorkflowAddresses)
            .where(eq(emailWorkflowAddresses.fullAddress, fullAddress.toLowerCase()))
            .limit(1);
        return result[0] ?? null;
    },

    async findById(id: string, workspaceId: string) {
        const result = await db
            .select()
            .from(emailWorkflowAddresses)
            .where(
                and(
                    eq(emailWorkflowAddresses.id, id),
                    eq(emailWorkflowAddresses.workspaceId, workspaceId)
                )
            )
            .limit(1);
        return result[0] ?? null;
    },

    async update(
        id: string,
        workspaceId: string,
        data: Partial<{
            suffix: string;
            fullAddress: string;
            instructions: string;
            enabled: boolean;
        }>
    ) {
        const result = await db
            .update(emailWorkflowAddresses)
            .set({ ...data, updatedAt: new Date() })
            .where(
                and(
                    eq(emailWorkflowAddresses.id, id),
                    eq(emailWorkflowAddresses.workspaceId, workspaceId)
                )
            )
            .returning();
        return result[0] ?? null;
    },

    async delete(id: string, workspaceId: string) {
        await db
            .delete(emailWorkflowAddresses)
            .where(
                and(
                    eq(emailWorkflowAddresses.id, id),
                    eq(emailWorkflowAddresses.workspaceId, workspaceId)
                )
            );
    },
};
