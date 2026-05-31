// 真正啟動的進入點；單元測試 import createApp 而不啟動 listen
import { createApp } from './app';
import { getLogger } from './lib/logger';
import { McpSessionPool } from './mcp/session-pool';
import { SseMcpSessionFactory } from './mcp/sse-session';
import { refreshAccessToken, loadOAuthConfig } from './services/auth/oauth';
import { getPool } from './db/pool';
import { AnthropicLlm, type LlmClient } from './services/nlq/llm';
import type { NlqDeps } from './routes/nlq';
// 002-scheduled-services
import { createScheduleConfigsRepo } from './db/repositories/schedule-configs';
import { createServiceLogsRepo } from './db/repositories/service-logs';
import { Scheduler } from './jobs/scheduler';
import { stubChkproj, stubChkissue } from './jobs/services/stub';
import type { ServiceRegistry } from './jobs/services/types';

const log = getLogger();
const port = Number(process.env.PORT ?? 8080);
const mcpUrl = process.env.MCP_ATLASSIAN_URL ?? 'http://mcp-atlassian:9000/sse';
const factory = new SseMcpSessionFactory({ url: mcpUrl });
const pool = new McpSessionPool({ factory });

const acquireSession = async (userId: string) => {
  const config = loadOAuthConfig();
  const refreshed = await refreshAccessToken(userId, config, { pool: getPool() });
  return pool.acquire(userId, refreshed.accessToken);
};

// 動態載入 Anthropic SDK，避免無 ANTHROPIC_API_KEY 環境也能起服務（NLQ 端點將回 503）
async function buildNlqDeps(): Promise<NlqDeps | undefined> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'placeholder') {
    log.warn('ANTHROPIC_API_KEY 未設定；/api/v1/nlq/query 將不可用');
    return undefined;
  }
  try {
    const mod = await import('@anthropic-ai/sdk');
    const Ctor: new (opts: { apiKey: string }) => unknown =
      (mod as { default?: typeof mod['Anthropic'] }).default ?? mod.Anthropic;
    type SdkType = NonNullable<ConstructorParameters<typeof AnthropicLlm>[0]['sdk']>;
    const sdk = new Ctor({ apiKey }) as SdkType;
    const llm: LlmClient = new AnthropicLlm({ apiKey, sdk });
    return { acquireSession, llm };
  } catch (err) {
    log.error({ err }, '載入 @anthropic-ai/sdk 失敗；/api/v1/nlq/query 將不可用');
    return undefined;
  }
}

// 啟動 scheduler；CHKPROJ / CHKISSUE 暫用 stub（Phase 5 / 6 將取代）
const scheduleConfigsRepo = createScheduleConfigsRepo(getPool());
const serviceLogsRepo = createServiceLogsRepo(getPool());
const services: ServiceRegistry = {
  CHKPROJ: stubChkproj,
  CHKISSUE: stubChkissue,
};
const scheduler = new Scheduler({
  pool: getPool(),
  serviceLogsRepo,
  scheduleConfigsRepo,
  services,
  acquireSession: async () => {
    // 服務本身須以「管理者」身份呼叫 mcp；v1 採第一個 admin accountId
    const adminIds = (process.env.ADMIN_ACCOUNT_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (adminIds.length === 0) throw new Error('ADMIN_ACCOUNT_IDS 未設定');
    // 從 atlassian_account_id 反查 users.id
    const { rows } = await getPool().query<{ id: string }>(
      `SELECT id FROM users WHERE atlassian_account_id = $1`,
      [adminIds[0]],
    );
    const userId = rows[0]?.id;
    if (!userId) throw new Error(`管理者 ${adminIds[0]} 未登入過此系統`);
    return acquireSession(userId);
  },
});

void (async () => {
  const nlqDeps = await buildNlqDeps();
  const app = createApp({
    projectsDeps: { acquireSession },
    peopleDeps: { acquireSession },
    bulkDeps: { acquireSession },
    ...(nlqDeps ? { nlqDeps } : {}),
    serviceLogsDeps: {
      repo: serviceLogsRepo,
    },
    schedulesDeps: {
      runnerDeps: {
        pool: getPool(),
        serviceLogsRepo,
        scheduleConfigsRepo,
        services,
        acquireSession: async () => {
          // 與 scheduler.acquireSession 相同
          const adminIds = (process.env.ADMIN_ACCOUNT_IDS ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          if (adminIds.length === 0) throw new Error('ADMIN_ACCOUNT_IDS 未設定');
          const { rows } = await getPool().query<{ id: string }>(
            `SELECT id FROM users WHERE atlassian_account_id = $1`,
            [adminIds[0]],
          );
          const userId = rows[0]?.id;
          if (!userId) throw new Error(`管理者 ${adminIds[0]} 未登入過此系統`);
          return acquireSession(userId);
        },
      },
      scheduler,
      repo: scheduleConfigsRepo,
      serviceLogsRepo,
    },
  });
  app.listen(port, async () => {
    log.info({ port }, '[backend] listening');
    try {
      await scheduler.start();
      log.info({ count: scheduler.registeredCount() }, '[scheduler] started');
    } catch (err) {
      log.error({ err }, '[scheduler] start failed');
    }
  });
})();

// 優雅關閉
async function shutdown(): Promise<void> {
  log.info('[backend] shutting down');
  try {
    await scheduler.stop();
  } catch (err) {
    log.warn({ err }, '[scheduler] stop failed');
  }
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
