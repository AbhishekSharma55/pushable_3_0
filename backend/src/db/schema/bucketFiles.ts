import { bigint, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";
import { sessions } from "./sessions.ts";
import { agents } from "./agents.ts";

export const fileSourceEnum = pgEnum("file_source", [
    "chat_upload",
    "agent_generated",
    "api_upload",
]);

export const bucketFiles = pgTable("bucket_files", {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    folder: text("folder").default("/").notNull(),
    source: fileSourceEnum("source").notNull(),
    sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "set null" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    uploadedBy: uuid("uploaded_by"),
    metadata: jsonb("metadata").default("{}").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
