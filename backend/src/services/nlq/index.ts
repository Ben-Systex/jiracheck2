// T052：NLQ analyze service
// 流程：
//   redactor → llm → schema 驗 → translator(explanation + execute) → status
// 狀態判斷：
//   - LLM 回 clarification → status=clarification_needed
//   - LLM 回 plan 但 schema 不通過 → status=error
//   - 執行後 partialPermission=true → status=partial_permission
//   - 其他 → status=ok
// 對 FR-024 / FR-025：本 service 為唯讀；不呼叫任何 edit/transition

import type { McpSession } from '../../mcp/types';
import { redactForLlm } from './redactor';
import { QueryPlanSchema, type QueryPlan } from './query-plan.schema';
import { explainPlanZh, executePlan } from './translator';
import type { LlmClient } from './llm';

export type NlqStatus = 'ok' | 'clarification_needed' | 'partial_permission' | 'error';

export interface AnalyzeArgs {
  question: string;
  executeImmediately?: boolean;
  llm: LlmClient;
  session: McpSession;
  /** 注入時間（測試） */
  now?: () => number;
}

export interface AnalyzeResult {
  status: NlqStatus;
  explanationZh: string;
  plan: QueryPlan | null;
  results?: Record<string, unknown>;
  clarificationQuestions?: string[];
  resultCount: number;
  partialPermission: boolean;
  truncated: boolean;
  latencyMs: number;
}

export class NlqError extends Error {
  constructor(public readonly code: 'too_long' | 'too_short' | 'unparseable', detail?: string) {
    super(detail ?? code);
    this.name = 'NlqError';
  }
}

const QUESTION_MAX = 1000;

export async function analyze(args: AnalyzeArgs): Promise<AnalyzeResult> {
  const started = (args.now ?? Date.now)();
  validateQuestion(args.question);
  const { text: redacted } = redactForLlm(args.question);
  const llmRes = await args.llm.complete({ question: redacted });
  const parsed = tryParseJson(llmRes.rawText);

  const elapsed = () => (args.now ?? Date.now)() - started;

  if (looksLikeClarification(parsed)) {
    return clarificationResult(parsed as { questions: string[] }, elapsed());
  }
  const planParse = QueryPlanSchema.safeParse(parsed);
  if (!planParse.success) {
    return errorResult(elapsed());
  }
  const plan = planParse.data;
  const explanationZh = explainPlanZh(plan);

  if (args.executeImmediately === false) {
    return planOnlyResult(plan, explanationZh, elapsed());
  }
  const exec = await executePlan(args.session, plan);
  return executedResult(plan, explanationZh, exec, elapsed());
}

function validateQuestion(q: string): void {
  if (q.length === 0) throw new NlqError('too_short');
  if (q.length > QUESTION_MAX) throw new NlqError('too_long');
}

function clarificationResult(parsed: { questions: string[] }, latencyMs: number): AnalyzeResult {
  return {
    status: 'clarification_needed',
    explanationZh: '系統無法解讀，請補充必要資訊',
    plan: null,
    clarificationQuestions: parsed.questions,
    resultCount: 0,
    partialPermission: false,
    truncated: false,
    latencyMs,
  };
}

function errorResult(latencyMs: number): AnalyzeResult {
  return {
    status: 'error',
    explanationZh: '系統無法解讀此問句，請改寫後再試',
    plan: null,
    resultCount: 0,
    partialPermission: false,
    truncated: false,
    latencyMs,
  };
}

function planOnlyResult(plan: QueryPlan, explanationZh: string, latencyMs: number): AnalyzeResult {
  return {
    status: 'ok',
    explanationZh,
    plan,
    resultCount: 0,
    partialPermission: false,
    truncated: false,
    latencyMs,
  };
}

function executedResult(
  plan: QueryPlan,
  explanationZh: string,
  exec: { results: Record<string, unknown>; resultCount: number; partialPermission: boolean; truncated: boolean },
  latencyMs: number,
): AnalyzeResult {
  return {
    status: exec.partialPermission ? 'partial_permission' : 'ok',
    explanationZh,
    plan,
    results: exec.results,
    resultCount: exec.resultCount,
    partialPermission: exec.partialPermission,
    truncated: exec.truncated,
    latencyMs,
  };
}

function tryParseJson(s: string): unknown {
  const trimmed = stripCodeFence(s.trim());
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function stripCodeFence(s: string): string {
  const m = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(s);
  return m ? m[1]! : s;
}

function looksLikeClarification(v: unknown): boolean {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as { needsClarification?: unknown }).needsClarification === true &&
    Array.isArray((v as { questions?: unknown }).questions)
  );
}
