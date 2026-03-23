import {
    integer,
    jsonb,
    pgEnum,
    pgTable,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";

export const ledgerTypeEnum = pgEnum("ledger_type", [
    "subscription_grant",
    "topup",
    "chat_message",
    "task_run",
    "workflow_step",
    "kb_upload",
    "kb_query",
    "browser_action",
    "scheduled_run_fee",
    "agent_delegation",
    "overage",
    "refund",
    "manual_adjustment",
]);

export const creditLedger = pgTable("credit_ledger", {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    type: ledgerTypeEnum("type").notNull(),
    creditsAfter: integer("credits_after").notNull(),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});
