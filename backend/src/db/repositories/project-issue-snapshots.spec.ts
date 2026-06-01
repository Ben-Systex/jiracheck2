// T060：project-issue-snapshots repository 單元測試
import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { createProjectIssueSnapshotsRepo } from './project-issue-snapshots';

function mockPool(impl: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number | null }>): Pool {
  return { query: vi.fn(impl) } as unknown as Pool;
}

describe('insertBatch', () => {
  it('snapshots 空 → 不執行 query', async () => {
    const queryFn = vi.fn(async () => ({ rows: [] }));
    const repo = createProjectIssueSnapshotsRepo({ query: queryFn } as unknown as Pool);
    await repo.insertBatch({ serviceLogId: 'sl-1', snapshots: [] });
    expect(queryFn).not.toHaveBeenCalled();
  });

  it('多筆 snapshot 拼成單 INSERT', async () => {
    let seenSql = '';
    let seenParams: unknown[] = [];
    const repo = createProjectIssueSnapshotsRepo(
      mockPool(async (sql, p) => {
        seenSql = sql;
        seenParams = (p ?? []) as unknown[];
        return { rows: [], rowCount: 3 };
      }),
    );
    await repo.insertBatch({
      serviceLogId: 'sl-1',
      snapshots: [
        { projectKey: 'A', hasIssues: true, issueCount: 5 },
        { projectKey: 'B', hasIssues: false, issueCount: 0 },
        { projectKey: 'C', hasIssues: true, issueCount: 2 },
      ],
    });
    expect(seenSql).toMatch(/INSERT INTO project_issue_snapshots/);
    // 4 個欄位 × 3 筆 + serviceLogId 共用 = 1 + 9 = 10 個 params
    expect(seenParams).toHaveLength(10);
    expect(seenParams[0]).toBe('sl-1');
    expect(seenParams[1]).toBe('A');
    expect(seenParams[2]).toBe(true);
    expect(seenParams[3]).toBe(5);
  });
});

describe('getStreakAt', () => {
  it('全 has_issues=false → 回 maxN', async () => {
    const repo = createProjectIssueSnapshotsRepo(
      mockPool(async () => ({
        rows: [{ has_issues: false }, { has_issues: false }, { has_issues: false }, { has_issues: false }],
      })),
    );
    expect(await repo.getStreakAt('A', 4)).toBe(4);
  });

  it('最近一筆有任務 → streak=0', async () => {
    const repo = createProjectIssueSnapshotsRepo(
      mockPool(async () => ({
        rows: [{ has_issues: true }, { has_issues: false }, { has_issues: false }],
      })),
    );
    expect(await repo.getStreakAt('A', 5)).toBe(0);
  });

  it('連續 3 筆 false 後被打斷', async () => {
    const repo = createProjectIssueSnapshotsRepo(
      mockPool(async () => ({
        rows: [
          { has_issues: false },
          { has_issues: false },
          { has_issues: false },
          { has_issues: true },
          { has_issues: false },
        ],
      })),
    );
    expect(await repo.getStreakAt('A', 10)).toBe(3);
  });

  it('無紀錄 → 0', async () => {
    const repo = createProjectIssueSnapshotsRepo(mockPool(async () => ({ rows: [] })));
    expect(await repo.getStreakAt('A', 10)).toBe(0);
  });

  it('maxN 限制查詢上限', async () => {
    let seenParams: unknown[] = [];
    const repo = createProjectIssueSnapshotsRepo(
      mockPool(async (_sql, p) => {
        seenParams = (p ?? []) as unknown[];
        return { rows: [] };
      }),
    );
    await repo.getStreakAt('A', 4);
    expect(seenParams[1]).toBe(4);
  });

  it('maxN < 1 → clamp 為 1', async () => {
    let seenParams: unknown[] = [];
    const repo = createProjectIssueSnapshotsRepo(
      mockPool(async (_sql, p) => {
        seenParams = (p ?? []) as unknown[];
        return { rows: [] };
      }),
    );
    await repo.getStreakAt('A', 0);
    expect(seenParams[1]).toBe(1);
  });
});

describe('pruneOlderThanDays', () => {
  it('回 rowCount', async () => {
    const repo = createProjectIssueSnapshotsRepo(mockPool(async () => ({ rows: [], rowCount: 12 })));
    expect(await repo.pruneOlderThanDays(90)).toBe(12);
  });
  it('rowCount null → 0', async () => {
    const repo = createProjectIssueSnapshotsRepo(mockPool(async () => ({ rows: [], rowCount: null })));
    expect(await repo.pruneOlderThanDays(90)).toBe(0);
  });
});
