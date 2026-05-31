-- 0003_scheduled_services.down
-- feature 002-scheduled-services 反向遷移

BEGIN;

DROP TABLE IF EXISTS project_issue_snapshots;
DROP TABLE IF EXISTS service_logs;
DROP TABLE IF EXISTS project_check_lists;
DROP TABLE IF EXISTS schedule_configs;

COMMIT;
