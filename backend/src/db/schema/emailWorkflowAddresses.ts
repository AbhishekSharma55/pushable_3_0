import {
    boolean,
    pgTable,
    text,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";
import { emailWorkspaceAddresses } from "./emailWorkspaceAddresses.ts";

export const emailWorkflowAddresses = pgTable("email_workflow_addresses", {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
    emailAddressId: uuid("email_address_id")
        .notNull()
        .references(() => emailWorkspaceAddresses.id, { onDelete: "cascade" }),
    suffix: text("suffix").notNull(),
    fullAddress: text("full_address").notNull().unique(),
    instructions: text("instructions").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
