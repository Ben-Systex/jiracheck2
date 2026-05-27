// T051：Anthropic Claude wrapper（DI 友善）
// - 預設模型 claude-sonnet-4-6；fallback haiku-4-5（process.env 控制）
// - prompt caching 啟用（research R-003）
// - 對外暴露 LlmClient interface；測試 / Phase 4 service 注入 mock
// - 不在此處呼叫 Anthropic 真正 API，除非 NlqLlm.createDefault 被 server.ts 使用

import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface LlmCompletionRequest {
  /** redactor 處理後的問句（FR-024 / research R-003） */
  question: string;
  /** 由 service 在問句前加上的 context；例如「目前可見專案 keys」 */
  contextLines?: string[];
}

export interface LlmCompletionResponse {
  /** Anthropic 回傳的純文字（應為 QueryPlan JSON 或 clarification 物件） */
  rawText: string;
  latencyMs: number;
  model: string;
}

export interface LlmClient {
  complete(req: LlmCompletionRequest): Promise<LlmCompletionResponse>;
}

// ---- default Anthropic implementation -------------------------------------

interface AnthropicSdkLike {
  messages: {
    create(args: {
      model: string;
      max_tokens: number;
      system: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>;
      messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    }): Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
}

export interface AnthropicLlmOptions {
  apiKey: string;
  primaryModel?: string;
  fallbackModel?: string;
  systemPromptPath?: string;
  /** 注入用：測試或 server.ts 動態載入 SDK */
  sdk?: AnthropicSdkLike;
  /** 取得當下時間（測試可注入） */
  now?: () => number;
}

export class AnthropicLlm implements LlmClient {
  private readonly primary: string;
  private readonly fallback: string;
  private readonly system: string;
  private readonly sdk: AnthropicSdkLike;
  private readonly now: () => number;

  constructor(opts: AnthropicLlmOptions) {
    this.primary = opts.primaryModel ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
    this.fallback = opts.fallbackModel ?? process.env.ANTHROPIC_FALLBACK_MODEL ?? 'claude-haiku-4-5-20251001';
    this.system = readSystemPrompt(opts.systemPromptPath);
    if (!opts.sdk) throw new Error('AnthropicLlm 需注入 sdk（請於 server.ts 載入 @anthropic-ai/sdk）');
    this.sdk = opts.sdk;
    this.now = opts.now ?? Date.now;
  }

  async complete(req: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    const started = this.now();
    const userContent = [
      ...(req.contextLines ?? []).map((l) => `# Context\n${l}`),
      `# Question\n${req.question}`,
    ].join('\n\n');
    try {
      return await this.invoke(this.primary, userContent, started);
    } catch (err) {
      // 對 5xx / rate_limit 嘗試 fallback；其他直接拋
      if (!isRetryableLlmError(err)) throw err;
      return this.invoke(this.fallback, userContent, started);
    }
  }

  private async invoke(model: string, content: string, started: number): Promise<LlmCompletionResponse> {
    const res = await this.sdk.messages.create({
      model,
      max_tokens: 1024,
      system: [{ type: 'text', text: this.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content }],
    });
    const text = res.content.map((c) => c.text ?? '').join('');
    return { rawText: text, latencyMs: this.now() - started, model };
  }
}

function isRetryableLlmError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { status?: number; message?: string };
  return e.status === 429 || (typeof e.status === 'number' && e.status >= 500);
}

function readSystemPrompt(p?: string): string {
  const filePath = p ?? path.join(__dirname, 'prompts', 'nlq.system.md');
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return 'You are the Jira 小幫手 planner. Return only JSON.';
  }
}
