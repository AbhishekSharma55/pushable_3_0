-- Testing system: test suites and test cases

CREATE TABLE IF NOT EXISTS "test_suites" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "workspace_id" uuid NOT NULL,
    "agent_id" uuid NOT NULL,
    "name" text NOT NULL,
    "description" text,
    "status" text DEFAULT 'draft' NOT NULL,
    "created_by" uuid,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "test_cases" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "suite_id" uuid NOT NULL,
    "workspace_id" uuid NOT NULL,
    "title" text NOT NULL,
    "input" text NOT NULL,
    "expected_behavior" text NOT NULL,
    "actual_response" text,
    "status" text DEFAULT 'pending' NOT NULL,
    "evaluation_notes" text,
    "execution_time_ms" integer,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "executed_at" timestamp
);

-- New column on agents
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "is_tester" boolean DEFAULT false NOT NULL;

-- Foreign keys for test_suites
ALTER TABLE "test_suites" ADD CONSTRAINT "test_suites_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "test_suites" ADD CONSTRAINT "test_suites_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "test_suites" ADD CONSTRAINT "test_suites_created_by_agents_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;

-- Foreign keys for test_cases
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_suite_id_test_suites_id_fk" FOREIGN KEY ("suite_id") REFERENCES "public"."test_suites"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
