// T092：telemetry 單元測試
import { describe, it, expect } from 'vitest';
import {
  traceSpan,
  getTracer,
  registerActiveTelemetry,
  shutdownTelemetry,
  __resetTelemetryForTesting,
} from './telemetry';

describe('getTracer', () => {
  it('回傳 OTel API 預設 tracer（noop）', () => {
    const t = getTracer();
    expect(t).toBeDefined();
    expect(typeof t.startActiveSpan).toBe('function');
  });
});

describe('traceSpan', () => {
  it('回傳 fn 的結果', async () => {
    const r = await traceSpan('test.ok', async () => 'value');
    expect(r).toBe('value');
  });

  it('fn 拋錯時 rethrow', async () => {
    await expect(
      traceSpan('test.fail', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow(/boom/);
  });

  it('帶 attrs 不報錯（undefined 自動跳過）', async () => {
    const r = await traceSpan(
      'test.attrs',
      async () => 1,
      { a: 'x', b: 2, c: true, d: undefined },
    );
    expect(r).toBe(1);
  });

  it('傳遞 span 給 fn 可被 setAttribute', async () => {
    await traceSpan('test.span-arg', async (span) => {
      expect(span).toBeDefined();
      span.setAttribute('k', 'v');
      return undefined;
    });
  });
});

describe('telemetry shutdown', () => {
  it('無 active 時 shutdown noop', async () => {
    __resetTelemetryForTesting();
    await expect(shutdownTelemetry()).resolves.toBeUndefined();
  });

  it('有 active 時呼叫 shutdown 並清掉', async () => {
    let called = false;
    registerActiveTelemetry({
      async shutdown() {
        called = true;
      },
    });
    await shutdownTelemetry();
    expect(called).toBe(true);
    // 第二次呼叫 noop
    await shutdownTelemetry();
  });
});
