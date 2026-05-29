// MCP client 抽象。Phase 2 提供「型別 + Pool 行為」；實際 SSE 連線細節
// 由 sse-session.ts 委派 @modelcontextprotocol/sdk。

export interface McpToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface McpToolResult<T = unknown> {
  content: T;
  isError?: boolean;
}

export interface McpSession {
  /** 進行一次 tool call；回傳 raw 結構，再由 services/jira/* 做 schema 驗證 */
  callTool<T = unknown>(call: McpToolCall): Promise<McpToolResult<T>>;
  /** 釋放底層 SSE 連線 */
  close(): Promise<void>;
}

export interface McpSessionFactory {
  /** 建立一條帶該使用者 OAuth access token 的 SSE 連線 */
  create(userId: string, accessToken: string): Promise<McpSession>;
}
