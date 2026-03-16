import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { users } from "../db/schema/index.ts";

export const userRepository = {
    async findByEmail(email: string) {
        const result = await db
            .select()
            .from(users)
            .where(eq(users.email, email))
            .limit(1);
        return result[0] ?? null;
    },

    async findById(id: string) {
        const result = await db
            .select()
            .from(users)
            .where(eq(users.id, id))
            .limit(1);
        return result[0] ?? null;
    },

    async create(data: { name: string; email: string; passwordHash: string }) {
        const result = await db.insert(users).values(data).returning();
        return result[0];
    },
};
