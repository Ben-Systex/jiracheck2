// T063：US3 人員搜尋 service
// - searchUsers：以 query 字串呼叫 MCP user search 工具
// - 對應 OpenAPI PersonRef 結構（accountId / displayName / email / avatarUrl）
//
// mcp-atlassian 工具名稱：`user_search`（research R-001 對應 tool）
// 回傳結構（部分 Jira REST 直通）：
//   { users: [{ accountId, displayName, emailAddress?, avatarUrls?: { '48x48'? } }] }

import type { McpSession } from '../../mcp/types';

export interface PersonRef {
  accountId: string;
  displayName: string;
  email?: string | null;
  avatarUrl?: string | null;
}

interface McpUserRaw {
  accountId: string;
  displayName: string;
  emailAddress?: string;
  avatarUrls?: Record<string, string>;
}

interface McpUserSearchResult {
  users?: McpUserRaw[];
}

export async function searchUsers(
  session: McpSession,
  q: string,
): Promise<PersonRef[]> {
  const res = await session.callTool<McpUserSearchResult>({
    name: 'user_search',
    arguments: { query: q, maxResults: 20 },
  });
  const raw = res.content?.users ?? [];
  return raw.map(toPersonRef);
}

function toPersonRef(u: McpUserRaw): PersonRef {
  return {
    accountId: u.accountId,
    displayName: u.displayName,
    email: u.emailAddress ?? null,
    avatarUrl: u.avatarUrls?.['48x48'] ?? null,
  };
}
