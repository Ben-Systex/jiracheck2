// 真正啟動的進入點；單元測試 import createApp 而不啟動 listen
import { createApp } from './app';
import { getLogger } from './lib/logger';
import { McpSessionPool } from './mcp/session-pool';
import { SseMcpSessionFactory } from './mcp/sse-session';
import { refreshAccessToken, loadOAuthConfig } from './services/auth/oauth';
import { getPool } from './db/pool';
import { AnthropicLlm, type LlmClient } from './services/nlq/llm';
import type { NlqDeps } from './routes/nlq';

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

void (async () => {
  const nlqDeps = await buildNlqDeps();
  const app = createApp({
    projectsDeps: { acquireSession },
    peopleDeps: { acquireSession },
    bulkDeps: { acquireSession },
    ...(nlqDeps ? { nlqDeps } : {}),
  });
  app.listen(port, () => {
    log.info({ port }, '[backend] listening');
  });
})();
