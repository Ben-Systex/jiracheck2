// per-user MCP session pool（research R-002）
// - 以 userId 為 key 持有一條 SSE 連線
// - LRU：超過 maxSize 時，evict 最久未使用者
// - idle timeout：每 5 秒掃描一次，超過 idleMs 未使用者主動關閉
// - acquire 後不必 release：pool 用 idle timer 管理生命週期
//
// T092：包裝 callTool 以記錄 jira_mcp_call_duration_seconds metric

import type { McpSession, McpSessionFactory, McpToolCall, McpToolResult } from './types';
import { jiraMcpCallDuration } from '../lib/metrics';

interface PoolEntry {
  userId: string;
  session: McpSession;
  lastUsedAt: number;
  /** 該使用者目前已知的 access token；不同 token 觸發重建 */
  accessToken: string;
}

export interface McpSessionPoolOptions {
  factory: McpSessionFactory;
  maxSize?: number;
  /** 超過此值未使用即關閉；預設 15 分鐘 */
  idleMs?: number;
  /** sweep 間隔；預設 5 秒。設 0 關閉 sweep（測試用） */
  sweepIntervalMs?: number;
  /** 目前時間取得函式；測試可注入 */
  now?: () => number;
}

export class McpSessionPool {
  private readonly entries = new Map<string, PoolEntry>();
  private readonly maxSize: number;
  private readonly idleMs: number;
  private readonly now: () => number;
  private sweepHandle: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly opts: McpSessionPoolOptions) {
    this.maxSize = opts.maxSize ?? 50;
    this.idleMs = opts.idleMs ?? 15 * 60 * 1000;
    this.now = opts.now ?? Date.now;
    const interval = opts.sweepIntervalMs ?? 5_000;
    if (interval > 0) {
      this.sweepHandle = setInterval(() => {
        this.sweep().catch(() => undefined);
      }, interval);
      // 不阻擋 process exit
      this.sweepHandle.unref?.();
    }
  }

  async acquire(userId: string, accessToken: string): Promise<McpSession> {
    const existing = this.entries.get(userId);
    if (existing && existing.accessToken === accessToken) {
      existing.lastUsedAt = this.now();
      return existing.session;
    }
    // token 變了：先收掉舊的
    if (existing) {
      await this.dispose(userId);
    }
    if (this.entries.size >= this.maxSize) {
      await this.evictOldest();
    }
    const rawSession = await this.opts.factory.create(userId, accessToken);
    const session = wrapWithMetrics(rawSession);
    this.entries.set(userId, {
      userId,
      session,
      accessToken,
      lastUsedAt: this.now(),
    });
    return session;
  }

  async dispose(userId: string): Promise<void> {
    const entry = this.entries.get(userId);
    if (!entry) return;
    this.entries.delete(userId);
    await safeClose(entry.session);
  }

  async closeAll(): Promise<void> {
    if (this.sweepHandle) clearInterval(this.sweepHandle);
    const tasks = [...this.entries.values()].map((e) => safeClose(e.session));
    this.entries.clear();
    await Promise.all(tasks);
  }

  size(): number {
    return this.entries.size;
  }

  /** 手動觸發 idle sweep（測試 / debug 用） */
  async sweep(): Promise<void> {
    const threshold = this.now() - this.idleMs;
    const expired: string[] = [];
    for (const [userId, entry] of this.entries.entries()) {
      if (entry.lastUsedAt < threshold) expired.push(userId);
    }
    await Promise.all(expired.map((u) => this.dispose(u)));
  }

  private async evictOldest(): Promise<void> {
    let oldestUser: string | undefined;
    let oldestTs = Infinity;
    for (const [userId, entry] of this.entries.entries()) {
      if (entry.lastUsedAt < oldestTs) {
        oldestTs = entry.lastUsedAt;
        oldestUser = userId;
      }
    }
    if (oldestUser !== undefined) await this.dispose(oldestUser);
  }
}

async function safeClose(session: McpSession): Promise<void> {
  try {
    await session.close();
  } catch {
    /* 吞掉：避免單一 session 關閉錯誤拖累整個 pool */
  }
}

/** 將原生 McpSession 包成可量測延遲的版本；tool 名為 label */
function wrapWithMetrics(session: McpSession): McpSession {
  return {
    async callTool<T = unknown>(call: McpToolCall): Promise<McpToolResult<T>> {
      const end = jiraMcpCallDuration.startTimer({ tool: call.name });
      try {
        const res = await session.callTool<T>(call);
        end({ status: res.isError ? 'error' : 'success' });
        return res;
      } catch (err) {
        end({ status: 'error' });
        throw err;
      }
    },
    close: () => session.close(),
  };
}
