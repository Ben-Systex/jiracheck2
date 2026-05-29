// T092：OpenTelemetry tracing thin wrapper
// 設計取向：
//   - 預設 noop（測試 / 本機 / CI 無須 OTLP collector 即可跑）
//   - 當 OTEL_EXPORTER_OTLP_ENDPOINT 設定時，server.ts 自行 import 完整 SDK 並呼叫
//     `setSdkTracerProvider(provider)`；本檔不直接依賴 sdk-node，避免拖入大量套件
//   - 所有業務程式碼透過 traceSpan(name, fn) 包關鍵路徑；自動 record exception + 結束 span
//
// 對應憲法 IV「可觀測性」：對關鍵路徑（auth / project listing / nlq / bulk）標 span

import { trace, SpanStatusCode, type Span, type Tracer } from '@opentelemetry/api';

const TRACER_NAME = 'jiracheck-backend';
const TRACER_VERSION = '0.1.0';

export function getTracer(): Tracer {
  return trace.getTracer(TRACER_NAME, TRACER_VERSION);
}

export interface SpanAttributes {
  [key: string]: string | number | boolean | undefined;
}

/**
 * 將 async fn 包進一個 span，並在 fn 拋錯時記 exception + status=ERROR。
 * 預設 attribute 會 redact undefined。
 */
export async function traceSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attrs: SpanAttributes = {},
): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan(name, async (span) => {
    try {
      applyAttrs(span, attrs);
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (err as Error)?.message ?? 'unknown',
      });
      throw err;
    } finally {
      span.end();
    }
  });
}

function applyAttrs(span: Span, attrs: SpanAttributes): void {
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined) continue;
    span.setAttribute(k, v);
  }
}

/** server.ts 在 OTLP endpoint 存在時動態載入 SDK，呼叫此函式裝設 provider。
 *  測試 / 本機開發無此函式呼叫，trace API 走 NoopTracerProvider，零 overhead。 */
export interface TelemetryShutdownable {
  shutdown(): Promise<void>;
}

let active: TelemetryShutdownable | undefined;

export function registerActiveTelemetry(s: TelemetryShutdownable): void {
  active = s;
}

export async function shutdownTelemetry(): Promise<void> {
  if (!active) return;
  await active.shutdown();
  active = undefined;
}

export function __resetTelemetryForTesting(): void {
  active = undefined;
}
