import { boolean, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";

export const proxyProtocolEnum = pgEnum("proxy_protocol", ["http", "https", "socks5"]);
export const proxyTestStatusEnum = pgEnum("proxy_test_status", ["success", "failed", "untested"]);

export const browserProxies = pgTable("browser_proxies", {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    host: text("host").notNull(),
    port: integer("port").notNull(),
    username: text("username").notNull(),
    password: text("password").notNull(),
    protocol: proxyProtocolEnum("protocol").default("http").notNull(),
    country: text("country"),
    city: text("city"),
    isActive: boolean("is_active").default(true).notNull(),
    lastTestedAt: timestamp("last_tested_at"),
    lastTestStatus: proxyTestStatusEnum("last_test_status").default("untested").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
