// US4 previewToken：以 HMAC-SHA256 簽名的 base64url JSON
// - 簽名金鑰：BULK_PREVIEW_SECRET（夠長亂數）；本機開發允許 fallback 到 TOKEN_ENC_KEY，
//   但 production 必須顯式設置
// - 結構：base64url(payloadJson).base64url(hmac)
// - TTL：30 分鐘（research R-008 / Phase 5 規格）

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { BulkTargetField } from '../../db/repositories/bulk-updates';

const TOKEN_TTL_MS = 30 * 60 * 1000;

export interface PreviewTokenPayload {
  /** 預覽當下的 user.id；apply 時必須與 sessionUser.userId 相符 */
  userId: string;
  projectKey: string;
  targetField: BulkTargetField;
  targetValueJson: unknown;
  filterDsl: Record<string, unknown>;
  /** 已通過權限檢查、預備寫入的 issueKey 陣列 */
  issueKeys: string[];
  /** 每筆 issue 的「變更前值」snapshot，便於 audit；以 issueKey 為 key */
  previousValues: Record<string, unknown>;
  /** preview 當下的命中筆數；與 issueKeys.length 一致 */
  totalCount: number;
  /** 過期 epoch ms */
  expiresAt: number;
}

export type TokenVerifyError =
  | 'malformed'
  | 'signature_invalid'
  | 'expired'
  | 'user_mismatch';

export interface TokenVerifyResult {
  ok: boolean;
  reason?: TokenVerifyError;
  payload?: PreviewTokenPayload;
}

function getSecret(): Buffer {
  const raw = process.env.BULK_PREVIEW_SECRET ?? process.env.TOKEN_ENC_KEY;
  if (!raw) throw new Error('BULK_PREVIEW_SECRET / TOKEN_ENC_KEY 未設置');
  return Buffer.from(raw, 'utf8');
}

export function signPreviewToken(
  payload: Omit<PreviewTokenPayload, 'expiresAt'>,
  nowMs: number = Date.now(),
): string {
  const full: PreviewTokenPayload = { ...payload, expiresAt: nowMs + TOKEN_TTL_MS };
  const payloadJson = JSON.stringify(full);
  const payloadB64 = Buffer.from(payloadJson, 'utf8').toString('base64url');
  const sig = createHmac('sha256', getSecret()).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

export function verifyPreviewToken(
  token: string,
  expectedUserId: string,
  nowMs: number = Date.now(),
): TokenVerifyResult {
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) {
    return { ok: false, reason: 'malformed' };
  }
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = createHmac('sha256', getSecret()).update(payloadB64).digest('base64url');
  const sigBuf = Buffer.from(sig, 'base64url');
  const expBuf = Buffer.from(expected, 'base64url');
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return { ok: false, reason: 'signature_invalid' };
  }

  let payload: PreviewTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as PreviewTokenPayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (payload.expiresAt < nowMs) {
    return { ok: false, reason: 'expired' };
  }
  if (payload.userId !== expectedUserId) {
    return { ok: false, reason: 'user_mismatch' };
  }
  return { ok: true, payload };
}
