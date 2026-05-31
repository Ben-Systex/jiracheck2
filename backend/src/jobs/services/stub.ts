// US1 MVP 用 stub 服務：CHKPROJ / CHKISSUE 各回固定字串
// US3 / US4 完成後（T052 / T063）會被實際 service 取代
import type { RegisteredService } from './types';

export const stubChkproj: RegisteredService = {
  id: 'CHKPROJ',
  needsMcpSession: false,
  async run() {
    return {
      result: 'success',
      summary: '[stub] CHKPROJ 尚未實作；Phase 5 將取代此 stub',
      notes: { stub: true },
      ruleVersion: 'rule-stub',
    };
  },
};

export const stubChkissue: RegisteredService = {
  id: 'CHKISSUE',
  needsMcpSession: false,
  async run() {
    return {
      result: 'success',
      summary: '[stub] CHKISSUE 尚未實作；Phase 6 將取代此 stub',
      notes: { stub: true },
    };
  },
};
