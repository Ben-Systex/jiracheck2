-- 0002_features: feature 級資料表
-- 對應 data-model.md 之 recent_project_access、query_history、
-- bulk_update_operations、bulk_update_items

-- ---------------------------------------------------------------------------
-- recent_project_access: US1 首頁「最近 5 個」
-- 一人最多保留 100 筆（由 repository 觸發 LRU）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recent_project_access (
  user_id           uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  project_key       text NOT NULL,
  last_accessed_at  timestamptz NOT NULL DEFAULT now(),
  access_count      integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, project_key)
);

CREATE INDEX IF NOT EXISTS recent_project_access_user_time_idx
  ON recent_project_access (user_id, last_accessed_at DESC);

-- ---------------------------------------------------------------------------
-- query_history: US2 自然語言查詢紀錄
-- 保留 90 天（由排程清理）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS query_history (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  original_question text NOT NULL CHECK (char_length(original_question) <= 1000),
  query_plan        jsonb NOT NULL,
  explanation_zh    text NOT NULL,
  result_count      integer NOT NULL DEFAULT 0,
  latency_ms        integer NOT NULL DEFAULT 0,
  status            text NOT NULL
    CHECK (status IN ('ok', 'partial_permission', 'clarification_needed', 'error')),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS query_history_user_time_idx
  ON query_history (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS query_history_plan_gin_idx
  ON query_history USING gin (query_plan jsonb_path_ops);

-- ---------------------------------------------------------------------------
-- bulk_update_operations: US4 審計紀錄
-- 保留 12 個月
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bulk_update_operations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  project_key         text NOT NULL,
  filter_dsl          jsonb NOT NULL,
  target_field        text NOT NULL
    CHECK (target_field IN ('assignee', 'due_date', 'label', 'priority', 'sprint')),
  target_value_json   jsonb NOT NULL,
  total_count         integer NOT NULL CHECK (total_count >= 0 AND total_count <= 200),
  confirmed_at        timestamptz NOT NULL,
  completed_at        timestamptz,
  status              text NOT NULL
    CHECK (status IN ('running', 'success', 'partial_failure', 'failure', 'cancelled')),
  success_count       integer NOT NULL DEFAULT 0,
  failure_count       integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS bulk_ops_user_time_idx
  ON bulk_update_operations (user_id, confirmed_at DESC);
CREATE INDEX IF NOT EXISTS bulk_ops_user_project_idx
  ON bulk_update_operations (user_id, project_key, confirmed_at DESC);
CREATE INDEX IF NOT EXISTS bulk_ops_status_idx
  ON bulk_update_operations (status);

-- ---------------------------------------------------------------------------
-- bulk_update_items: 每筆 issue 結果
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bulk_update_items (
  operation_id        uuid NOT NULL REFERENCES bulk_update_operations (id) ON DELETE CASCADE,
  issue_key           text NOT NULL,
  previous_value_json jsonb,
  new_value_json      jsonb NOT NULL,
  result              text NOT NULL
    CHECK (result IN ('success', 'permission_denied', 'version_conflict', 'api_error')),
  error_message       text,
  applied_at          timestamptz,
  PRIMARY KEY (operation_id, issue_key)
);

CREATE INDEX IF NOT EXISTS bulk_items_op_result_idx
  ON bulk_update_items (operation_id, result);
