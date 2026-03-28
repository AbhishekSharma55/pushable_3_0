-- Create a CEO agent for every workspace that doesn't already have one

INSERT INTO "agents" (
    "id",
    "workspace_id",
    "name",
    "emoji",
    "system_prompt",
    "model",
    "temperature",
    "system_level_access",
    "can_manage_kb",
    "can_manage_skills",
    "can_manage_tools",
    "can_manage_schedules",
    "can_manage_channels",
    "can_manage_agents",
    "can_manage_bucket",
    "can_execute_python",
    "bucket_folder",
    "require_approval_for_all",
    "browser_type",
    "browser_enabled",
    "is_ceo",
    "is_tester",
    "agent_type",
    "created_at",
    "updated_at"
)
SELECT
    gen_random_uuid(),
    w."id",
    'CEO',
    '🧠',
    '',
    'claude-sonnet-4-20250514',
    0.7,
    true,       -- system_level_access
    true,       -- can_manage_kb
    true,       -- can_manage_skills
    true,       -- can_manage_tools
    true,       -- can_manage_schedules
    true,       -- can_manage_channels
    true,       -- can_manage_agents
    true,       -- can_manage_bucket
    false,      -- can_execute_python
    '/ceo',
    false,      -- require_approval_for_all
    'cloud',
    false,      -- browser_enabled
    true,       -- is_ceo
    false,      -- is_tester
    'ceo',
    now(),
    now()
FROM "workspaces" w
WHERE NOT EXISTS (
    SELECT 1 FROM "agents" a
    WHERE a."workspace_id" = w."id"
      AND a."is_ceo" = true
);

-- Create a Tester agent for every workspace that doesn't already have one

INSERT INTO "agents" (
    "id",
    "workspace_id",
    "name",
    "emoji",
    "system_prompt",
    "model",
    "temperature",
    "system_level_access",
    "can_manage_kb",
    "can_manage_skills",
    "can_manage_tools",
    "can_manage_schedules",
    "can_manage_channels",
    "can_manage_agents",
    "can_manage_bucket",
    "can_execute_python",
    "bucket_folder",
    "require_approval_for_all",
    "browser_type",
    "browser_enabled",
    "is_ceo",
    "is_tester",
    "agent_type",
    "created_at",
    "updated_at"
)
SELECT
    gen_random_uuid(),
    w."id",
    'Tester',
    '🧪',
    '',
    'anthropic/claude-opus-4.6',
    0.3,
    true,       -- system_level_access
    true,       -- can_manage_kb
    true,       -- can_manage_skills
    true,       -- can_manage_tools
    false,      -- can_manage_schedules
    false,      -- can_manage_channels
    true,       -- can_manage_agents
    true,       -- can_manage_bucket
    false,      -- can_execute_python
    '/tester',
    false,      -- require_approval_for_all
    'cloud',
    false,      -- browser_enabled
    false,      -- is_ceo
    true,       -- is_tester
    'tester',
    now(),
    now()
FROM "workspaces" w
WHERE NOT EXISTS (
    SELECT 1 FROM "agents" a
    WHERE a."workspace_id" = w."id"
      AND a."is_tester" = true
);
