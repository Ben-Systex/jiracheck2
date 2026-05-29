// T048：US2 NLQ 送 LLM 前 redactor（research R-003）
// 規則：
//   - 移除 Bearer token / refresh_token 樣式
//   - 移除 email 樣式（避免 PII 進 LLM；displayName 自由保留）
//   - 移除疑似內部 ticket-like long id（>= 24 字元連續 hex 視為 token）
//   - 保留 Jira accountId 樣式（如 5b10ac... 或 712020:abc-... 都是 Atlassian accountId 形式）
//   - 保留 displayName / 中英文一般語句
// 注意：本 redactor 是「最後一道防線」，並不替代 LLM provider 端 PII 設定。

const PATTERNS: Array<{ name: string; re: RegExp; replacement: string }> = [
  // OAuth tokens
  { name: 'bearer', re: /\bBearer\s+[A-Za-z0-9._-]+/gi, replacement: 'Bearer [REDACTED]' },
  { name: 'refresh_token', re: /refresh_token\s*[:=]\s*['"]?[A-Za-z0-9._-]+['"]?/gi, replacement: 'refresh_token=[REDACTED]' },
  // email
  { name: 'email', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replacement: '[REDACTED_EMAIL]' },
  // 長 hex（≥ 32 hex chars 視為 token）
  { name: 'long_hex', re: /\b[0-9a-f]{32,}\b/gi, replacement: '[REDACTED_HEX]' },
];

export interface RedactResult {
  text: string;
  redactedKinds: string[];
}

export function redactForLlm(input: string): RedactResult {
  let text = input;
  const kinds = new Set<string>();
  for (const { name, re, replacement } of PATTERNS) {
    if (re.test(text)) {
      kinds.add(name);
      text = text.replace(re, replacement);
    }
  }
  return { text, redactedKinds: [...kinds] };
}
