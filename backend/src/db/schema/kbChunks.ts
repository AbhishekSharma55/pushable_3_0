import {
    jsonb,
    pgTable,
    real,
    text,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";
import { knowledgeBases } from "./knowledgeBases.ts";
import { kbDocuments } from "./kbDocuments.ts";

export const kbChunks = pgTable("kb_chunks", {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    kbId: uuid("kb_id")
        .notNull()
        .references(() => knowledgeBases.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
        .notNull()
        .references(() => kbDocuments.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    embedding: real("embedding").array().notNull(),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});
