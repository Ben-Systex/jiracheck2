// RFC 7807 problem details + zh-TW 對應
// - 統一錯誤回應格式，方便前端 ProblemErrorInterceptor 處理（憲法 III）

import type { Response } from 'express';
import { messages, type MessageKey } from './i18n/zh-TW';

export type ProblemCause =
  | 'validation'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'upstream'
  | 'rate_limited'
  | 'internal';

const STATUS_BY_CAUSE: Record<ProblemCause, number> = {
  validation: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  upstream: 502,
  rate_limited: 429,
  internal: 500,
};

const TYPE_URI = 'https://jiracheck.local/problem/';

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  cause: ProblemCause;
}

export interface ProblemOptions {
  /** 對應 i18n message key；以此取得使用者可讀的 zh-TW 標題 */
  messageKey?: MessageKey;
  /** 覆寫 title（少數情境用，預設用 messageKey 對應的訊息） */
  title?: string;
  /** 細節（可包含技術說明） */
  detail?: string;
}

export function buildProblem(cause: ProblemCause, opts: ProblemOptions = {}): ProblemDetails {
  const title = opts.title ?? (opts.messageKey ? messages[opts.messageKey] : messages.error_internal);
  return {
    type: `${TYPE_URI}${cause}`,
    title,
    status: STATUS_BY_CAUSE[cause],
    ...(opts.detail !== undefined ? { detail: opts.detail } : {}),
    cause,
  };
}

export function sendProblem(res: Response, problem: ProblemDetails): Response {
  return res
    .status(problem.status)
    .setHeader('Content-Type', 'application/problem+json')
    .json(problem);
}
