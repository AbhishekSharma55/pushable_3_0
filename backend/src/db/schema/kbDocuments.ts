import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";
import { knowledgeBases } from "./knowledgeBases.ts";

export const kbDocuments = pgTable("kb_documents", {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    kbId: uuid("kb_id")
        .notNull()
        .references(() => knowledgeBases.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    chunkCount: integer("chunk_count").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});
