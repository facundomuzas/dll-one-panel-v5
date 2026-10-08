CREATE TABLE IF NOT EXISTS panel_companies (
  company_id TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  phone_number_id TEXT NOT NULL DEFAULT '',
  modules JSONB NOT NULL DEFAULT '{}'::jsonb,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_version TEXT NOT NULL DEFAULT '',
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_panel_companies_synced_at
  ON panel_companies (synced_at DESC);

CREATE TABLE IF NOT EXISTS panel_sync_log (
  id BIGSERIAL PRIMARY KEY,
  company_id TEXT NOT NULL,
  ok BOOLEAN NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_panel_sync_log_company_created
  ON panel_sync_log (company_id, created_at DESC);
