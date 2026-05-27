# Anthropic API key 設定

US2「自然語言查詢」需要 Anthropic API key 才能運作；其他 user story 不依賴。

## 1. 取得 key

1. 進入 <https://console.anthropic.com/>
2. **API Keys → Create Key**
3. 命名（建議：`jiracheck2-{env}`，例 `jiracheck2-staging`）
4. 複製金鑰；只會顯示一次

## 2. 設定到 `ops/.env`

```ini
ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
# 預設使用 sonnet；失敗或 429 / 5xx 自動 fallback haiku-4-5
ANTHROPIC_MODEL=claude-sonnet-4-6
ANTHROPIC_FALLBACK_MODEL=claude-haiku-4-5-20251001
```

未設或留 placeholder：backend 仍可啟動，但 `/api/v1/nlq/query` 不可用（dynamic import @anthropic-ai/sdk 失敗時降為 disabled）。

## 3. 配額與成本

- 預設啟用 prompt caching（system prompt 5 分鐘 TTL）
- 對問句長度上限 1000 字元（FR-020）
- per-user rate limit 6 req/min；可在 `backend/src/routes/nlq.ts` 調整

## 4. NLQ accuracy gate

- fixture：`backend/tests/fixtures/nlq-accuracy/cases.yaml`（20+ 道）
- runner：`backend/tests/integration/nlq-accuracy.spec.ts`（預設 skip；CI nightly job 跑）
- 對應 SC-002 自動化驗證
