// 測試用 MCP session mock：以 tool name 為 key 路由請求
// 提供：
//   - createMockSession({...mapByName})：回傳一個 McpSession
//   - 直接記錄每一次 callTool（方便 assertion）

import type { McpSession, McpToolCall, McpToolResult } from '../../src/mcp/types';

export type MockToolHandler<T = unknown> = (
  args: Record<string, unknown>,
) => Promise<T> | T;

export interface MockSessionRecord {
  calls: McpToolCall[];
  session: McpSession;
}

export function createMockSession(
  handlers: Record<string, MockToolHandler>,
): MockSessionRecord {
  const calls: McpToolCall[] = [];
  const session: McpSession = {
    async callTool<T = unknown>(call: McpToolCall): Promise<McpToolResult<T>> {
      calls.push(call);
      const handler = handlers[call.name];
      if (!handler) {
        throw new Error(`mock: no handler for tool "${call.name}"`);
      }
      const content = (await handler(call.arguments)) as T;
      return { content };
    },
    async close() {
      /* noop */
    },
  };
  return { calls, session };
}
