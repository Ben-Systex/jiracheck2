// AES-256-GCM 加解密 refresh token
// 金鑰：TOKEN_ENC_KEY（base64，32 bytes）
// 設計目標：refresh token 永遠不可在 DB 以明文出現（憲法附加約束）

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export interface EncryptedPayload {
  ciphertext: Buffer;
  nonce: Buffer;
  tag: Buffer;
}

function loadKey(): Buffer {
  const b64 = process.env.TOKEN_ENC_KEY;
  if (!b64) {
    throw new Error('TOKEN_ENC_KEY is not set');
  }
  const key = Buffer.from(b64, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(`TOKEN_ENC_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}`);
  }
  return key;
}

export function encryptToken(plaintext: string): EncryptedPayload {
  const key = loadKey();
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGO, key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  if (tag.length !== TAG_BYTES) {
    throw new Error(`unexpected auth tag length: ${tag.length}`);
  }
  return { ciphertext, nonce, tag };
}

export function decryptToken(payload: EncryptedPayload): string {
  const key = loadKey();
  const decipher = createDecipheriv(ALGO, key, payload.nonce);
  decipher.setAuthTag(payload.tag);
  const plaintext = Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

/** 產生 32-byte base64 金鑰；CLI 工具或 ops 文件可呼叫 */
export function generateKeyBase64(): string {
  return randomBytes(KEY_BYTES).toString('base64');
}
