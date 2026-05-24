// SseMcpSessionFactory：以 @modelcontextprotocol/sdk 的 SSE transport
// 建立 per-user 連線。Phase 2 提供骨架，實際 Jira 工具呼叫由
// services/jira/* 在後續 phase 中接上。

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { McpSession, McpSessionFactory, McpToolCall, McpToolResult } from './types';

export interface SseMcpFactoryOptions {
  /** MCP server SSE 端點，例如 http://mcp-atlassian:9000/sse */
  url: string;
  clientName?: string;
  clientVersion?: string;
}

export class SseMcpSessionFactory implements McpSessionFactory {
  constructor(private readonly opts: SseMcpFactoryOptions) {}

  async create(userId: string, accessToken: string): Promise<McpSession> {
    const transport = new SSEClientTransport(new URL(this.opts.url), {
      requestInit: {
        // mcp-atlassian 預期由此 header 取得使用者授權
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Jira-User-Id': userId,
        },
      },
    });
    const client = new Client(
      { name: this.opts.clientName ?? 'jiracheck-backend', version: this.opts.clientVersion ?? '0.1.0' },
      { capabilities: {} },
    );
    await client.connect(transport);

    return {
      async callTool<T = unknown>(call: McpToolCall): Promise<McpToolResult<T>> {
        const res = await client.callTool({ name: call.name, arguments: call.arguments });
        return {
          content: res.content as unknown as T,
          ...(res.isError ? { isError: true } : {}),
        };
      },
      async close(): Promise<void> {
        await client.close();
      },
    };
  }
}
