import {
    boolean,
    jsonb,
    pgEnum,
    pgTable,
    text,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";
import { emailWorkspaceAddresses } from "./emailWorkspaceAddresses.ts";
import { sessions } from "./sessions.ts";
import { agents } from "./agents.ts";

export const emailStatusEnum = pgEnum("email_status", [
    "received",
    "routing",
    "processing",
    "awaiting_approval",
    "approved",
    "rejected",
    "completed",
    "failed",
    "spam",
]);

export const inboundEmails = pgTable("inbound_emails", {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    emailAddressId: uuid("email_address_id").references(
        () => emailWorkspaceAddresses.id,
        { onDelete: "set null" }
    ),
    sessionId: uuid("session_id").references(() => sessions.id, {
        onDelete: "set null",
    }),
    fromAddress: text("from_address").notNull(),
    fromName: text("from_name"),
    toAddress: text("to_address").notNull(),
    subject: text("subject"),
    bodyText: text("body_text"),
    bodyHtml: text("body_html"),
    cc: text("cc"),
    bcc: text("bcc"),
    messageId: text("message_id"),
    inReplyTo: text("in_reply_to"),
    references: text("references"),
    status: emailStatusEnum("status").default("received").notNull(),
    routedToAgentId: uuid("routed_to_agent_id").references(() => agents.id, {
        onDelete: "set null",
    }),
    attachments: jsonb("attachments").default([]).notNull(),
    statusHistory: jsonb("status_history").default([]).notNull(),
    replySent: boolean("reply_sent").default(false).notNull(),
    replyContent: text("reply_content"),
    errorMessage: text("error_message"),
    rawPayload: jsonb("raw_payload"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
