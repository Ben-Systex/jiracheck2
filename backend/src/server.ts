// 真正啟動的進入點；單元測試 import createApp 而不啟動 listen
import { createApp } from './app';
import { getLogger } from './lib/logger';
import { McpSessionPool } from './mcp/session-pool';
import { SseMcpSessionFactory } from './mcp/sse-session';
import { refreshAccessToken, loadOAuthConfig } from './services/auth/oauth';
import { getPool } from './db/pool';

const port = Number(process.env.PORT ?? 8080);
const log = getLogger();

const mcpUrl = process.env.MCP_ATLASSIAN_URL ?? 'http://mcp-atlassian:9000/sse';
const factory = new SseMcpSessionFactory({ url: mcpUrl });
const pool = new McpSessionPool({ factory });

const app = createApp({
  projectsDeps: {
    acquireSession: async (userId) => {
      const config = loadOAuthConfig();
      const refreshed = await refreshAccessToken(userId, config, { pool: getPool() });
      return pool.acquire(userId, refreshed.accessToken);
    },
  },
});

app.listen(port, () => {
  log.info({ port }, '[backend] listening');
});
