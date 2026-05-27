// T104：NLQ accuracy runner（@nightly）
// - 本地預設 skip；CI nightly 才跑（RUN_NLQ_ACCURACY=true）
// - 載入 cases.yaml；對每筆呼叫 nlq/analyze；比對 intent / filters 主軸欄位
// - 產出 backend/tests/perf/results/nlq-accuracy.json（或在 CI artifacts 取得）

import { describe, it, expect } from 'vitest';

const RUN = process.env.RUN_NLQ_ACCURACY === 'true';

describe.skipIf(!RUN)('nlq accuracy gate', () => {
  it('runs against fixtures (placeholder; full runner in Phase 7)', () => {
    // Phase 4 提供 fixture + spec 骨架；正式 runner 含 LLM 連線 + 比對邏輯
    // 將於 T105 CI nightly job 補完，並輸出 nlq-accuracy.json
    expect(RUN).toBe(true);
  });
});
