import { pgTable, text, timestamp, uuid, boolean } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";

export const blogs = pgTable("blogs", {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    content: text("content").notNull(),
    emoji: text("emoji"),
    tag: text("tag"),
    coverImage: text("cover_image"),
    author: text("author"),
    readTime: text("read_time"),
    featured: boolean("featured").default(false).notNull(),
    published: boolean("published").default(false).notNull(),
    publishedAt: timestamp("published_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
