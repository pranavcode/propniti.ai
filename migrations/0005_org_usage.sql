-- Monthly platform usage per customer org, for the platform admin's usage page.
CREATE TABLE org_usage_monthly (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  org_id TEXT NOT NULL,                 -- -> orgs.id
  month TEXT NOT NULL,                  -- 'YYYY-MM'
  agent_runs INTEGER NOT NULL DEFAULT 0,
  ai_actions INTEGER NOT NULL DEFAULT 0,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  active_users INTEGER NOT NULL DEFAULT 0,
  units_managed INTEGER NOT NULL DEFAULT 0,
  UNIQUE (workspace_id, id)
);
CREATE INDEX org_usage_monthly_org ON org_usage_monthly (workspace_id, org_id, month);
