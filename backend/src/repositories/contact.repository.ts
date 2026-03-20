import { eq, desc } from "drizzle-orm";
import { db } from "../db/client.ts";
import { contactSubmissions } from "../db/schema/index.ts";

export const contactRepository = {
    async create(data: {
        name: string;
        email: string;
        subject: string;
        message: string;
    }) {
        const result = await db.insert(contactSubmissions).values(data).returning();
        return result[0];
    },

    async findAll() {
        return db
            .select()
            .from(contactSubmissions)
            .orderBy(desc(contactSubmissions.createdAt));
    },

    async findById(id: string) {
        const result = await db
            .select()
            .from(contactSubmissions)
            .where(eq(contactSubmissions.id, id))
            .limit(1);
        return result[0] ?? null;
    },

    async updateStatus(id: string, data: { status: string; notes?: string }) {
        const result = await db
            .update(contactSubmissions)
            .set({ ...data, updatedAt: new Date() })
            .where(eq(contactSubmissions.id, id))
            .returning();
        return result[0] ?? null;
    },

    async delete(id: string) {
        await db
            .delete(contactSubmissions)
            .where(eq(contactSubmissions.id, id));
    },
};
