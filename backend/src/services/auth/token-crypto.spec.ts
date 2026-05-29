import { describe, it, expect, beforeAll } from 'vitest';
import { encryptToken, decryptToken, generateKeyBase64 } from './token-crypto';

describe('token-crypto', () => {
  beforeAll(() => {
    process.env.TOKEN_ENC_KEY = generateKeyBase64();
  });

  it('round-trips a refresh token', () => {
    const plain = 'rt_sample_atlassian_refresh_token_value_123';
    const enc = encryptToken(plain);
    expect(enc.ciphertext).toBeInstanceOf(Buffer);
    expect(enc.nonce.length).toBe(12);
    expect(enc.tag.length).toBe(16);
    expect(decryptToken(enc)).toBe(plain);
  });

  it('different encryptions produce different nonces / ciphertexts', () => {
    const plain = 'rt_same_input';
    const a = encryptToken(plain);
    const b = encryptToken(plain);
    expect(a.nonce.equals(b.nonce)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    // 但都能解
    expect(decryptToken(a)).toBe(plain);
    expect(decryptToken(b)).toBe(plain);
  });

  it('tampered ciphertext fails to decrypt', () => {
    const enc = encryptToken('payload');
    const tampered = { ...enc, ciphertext: Buffer.from([0xff, 0xff, 0xff, 0xff]) };
    expect(() => decryptToken(tampered)).toThrow();
  });

  it('throws when key is missing', () => {
    const orig = process.env.TOKEN_ENC_KEY;
    delete process.env.TOKEN_ENC_KEY;
    try {
      expect(() => encryptToken('x')).toThrowError(/TOKEN_ENC_KEY/);
    } finally {
      process.env.TOKEN_ENC_KEY = orig;
    }
  });
});
