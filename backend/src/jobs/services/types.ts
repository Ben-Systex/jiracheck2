// 002-scheduled-services：服務統一介面
// 每個內建服務（CHKPROJ / CHKISSUE / SYSTEM_CLEANUP）皆實作此 interface，由 service-runner 統一呼叫。

import type { McpSession } from '../../mcp/types';
import type { ExtendedServiceId, ServiceLogResult } from '../../db/repositories/service-logs';

export interface ServiceRunContext {
  /** 對應的 ServiceLog id（runner 已寫入 running 紀錄） */
  logId: string;
  /** 已驗 admin 的 mcp session；CHKPROJ / CHKISSUE 用以呼叫 mcp-atlassian */
  session: McpSession;
  /** 注入時間（測試用） */
  now: () => Date;
}

export interface ServiceRunResult {
  result: ServiceLogResult;
  /** 人類可讀總結（zh-TW） */
  summary: string;
  /** 結構化備註（errors[] / delayed[] / with_issues[] / ...） */
  notes: Record<string, unknown>;
  /** 規則版本（CHKPROJ 用），由 runner 直接寫入 service_logs.rule_version */
  ruleVersion?: string | null;
}

export interface RegisteredService {
  id: ExtendedServiceId;
  /** 是否需要 mcp session（CHKPROJ / CHKISSUE = true，SYSTEM_CLEANUP = false） */
  needsMcpSession: boolean;
  run(ctx: ServiceRunContext): Promise<ServiceRunResult>;
}

export type ServiceRegistry = Partial<Record<ExtendedServiceId, RegisteredService>>;
