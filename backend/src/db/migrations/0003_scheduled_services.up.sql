-- 0003_scheduled_services.up
-- feature 002-scheduled-services
-- 4 個新表：schedule_configs / service_logs / project_check_lists / project_issue_snapshots
-- 對應 specs/002-scheduled-services/data-model.md

BEGIN;

-- ---- 1. schedule_configs ---------------------------------------------------
CREATE TABLE schedule_configs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id      text NOT NULL CHECK (service_id IN ('CHKPROJ', 'CHKISSUE')),
  frequency_type  text NOT NULL CHECK (frequency_type IN ('daily', 'weekly', 'monthly', 'cron')),
  frequency_value text NOT NULL,
  enabled         boolean NOT NULL DEFAULT true,
  next_run_at     timestamptz,
  last_run_at     timestamptz,
  created_by      uuid NOT NULL REFERENCES users(id),
  updated_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_schedule_configs_enabled_next
  ON schedule_configs (enabled, next_run_at);
CREATE INDEX idx_schedule_configs_service
  ON schedule_configs (service_id);

-- ---- 2. service_logs ------------------------------------------------------
CREATE TABLE service_logs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id            uuid REFERENCES schedule_configs(id) ON DELETE SET NULL,
  service_id             text NOT NULL,
  triggered_by           text NOT NULL CHECK (triggered_by IN ('schedule', 'manual', 'system')),
  triggered_by_user_id   uuid REFERENCES users(id),
  started_at             timestamptz NOT NULL DEFAULT now(),
  ended_at               timestamptz,
  result                 text NOT NULL CHECK (result IN ('success', 'partial_failure', 'failure', 'skipped', 'missed')),
  summary                text NOT NULL,
  notes                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  rule_version           text
);

CREATE INDEX idx_service_logs_started
  ON service_logs (started_at DESC);
CREATE INDEX idx_service_logs_service_started
  ON service_logs (service_id, started_at DESC);
CREATE INDEX idx_service_logs_result
  ON service_logs (result);
CREATE INDEX idx_service_logs_schedule
  ON service_logs (schedule_id, started_at DESC);

-- ---- 3. project_check_lists -----------------------------------------------
CREATE TABLE project_check_lists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_key text NOT NULL UNIQUE,
  added_by    uuid NOT NULL REFERENCES users(id),
  added_at    timestamptz NOT NULL DEFAULT now(),
  note        text
);

-- ---- 4. project_issue_snapshots -------------------------------------------
CREATE TABLE project_issue_snapshots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_log_id  uuid NOT NULL REFERENCES service_logs(id) ON DELETE CASCADE,
  project_key     text NOT NULL,
  has_issues      boolean NOT NULL,
  issue_count     integer NOT NULL DEFAULT 0,
  snapshot_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pis_project_snapshot
  ON project_issue_snapshots (project_key, snapshot_at DESC);
CREATE INDEX idx_pis_service_log
  ON project_issue_snapshots (service_log_id);

COMMIT;
