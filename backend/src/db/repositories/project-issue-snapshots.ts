// T059：project_issue_snapshots repository（feature 002-scheduled-services / US4）
// CHKISSUE 每次執行對每個專案寫一筆 snapshot（has_issues / issue_count），
// 並用 snapshot 表回頭計算「連續 N 次無任務」（research R-009 / FR-032）。

import type { Pool } from 'pg';

export interface SnapshotEntry {
  projectKey: string;
  hasIssues: boolean;
  issueCount: number;
}

export interface InsertBatchArgs {
  serviceLogId: string;
  snapshots: SnapshotEntry[];
}

export interface ProjectIssueSnapshotsRepo {
  insertBatch(args: InsertBatchArgs): Promise<void>;
  /** 從最近往回算「連續 has_issues=false」的次數；上限 maxN 防止過度查詢 */
  getStreakAt(projectKey: string, maxN: number): Promise<number>;
  pruneOlderThanDays(days: number): Promise<number>;
}

export function createProjectIssueSnapshotsRepo(pool: Pool): ProjectIssueSnapshotsRepo {
  return {
    async insertBatch(args) {
      if (args.snapshots.length === 0) return;
      const values: string[] = [];
      const params: unknown[] = [args.serviceLogId];
      let i = 2;
      for (const s of args.snapshots) {
        values.push(`($1, $${i}, $${i + 1}, $${i + 2})`);
        params.push(s.projectKey, s.hasIssues, s.issueCount);
        i += 3;
      }
      await pool.query(
        `INSERT INTO project_issue_snapshots
           (service_log_id, project_key, has_issues, issue_count)
         VALUES ${values.join(', ')}`,
        params,
      );
    },

    async getStreakAt(projectKey, maxN) {
      // 取 projectKey 最近 maxN 筆 snapshot；連續從最新往回數 has_issues=false 的個數
      const { rows } = await pool.query<{ has_issues: boolean }>(
        `SELECT has_issues
         FROM project_issue_snapshots
         WHERE project_key = $1
         ORDER BY snapshot_at DESC
         LIMIT $2`,
        [projectKey, Math.max(1, maxN)],
      );
      let streak = 0;
      for (const r of rows) {
        if (r.has_issues) break;
        streak += 1;
      }
      return streak;
    },

    async pruneOlderThanDays(days) {
      const { rowCount } = await pool.query(
        `DELETE FROM project_issue_snapshots
          WHERE snapshot_at < now() - ($1 || ' days')::interval`,
        [String(days)],
      );
      return rowCount ?? 0;
    },
  };
}
