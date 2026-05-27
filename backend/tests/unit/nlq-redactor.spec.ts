// T043：redactor 單元測試

import { describe, it, expect } from 'vitest';
import { redactForLlm } from '../../src/services/nlq/redactor';

describe('nlq redactor', () => {
  it('strips Bearer token', () => {
    const r = redactForLlm('here is my Bearer abc.def-123');
    expect(r.text).toContain('Bearer [REDACTED]');
    expect(r.redactedKinds).toContain('bearer');
  });

  it('strips refresh_token assignments', () => {
    const r = redactForLlm("refresh_token='abcDEF1234567890'");
    expect(r.text).toContain('refresh_token=[REDACTED]');
    expect(r.redactedKinds).toContain('refresh_token');
  });

  it('strips email but preserves CJK content', () => {
    const r = redactForLlm('請列出 alice@example.com 在本季的任務');
    expect(r.text).toContain('[REDACTED_EMAIL]');
    expect(r.text).toContain('在本季的任務');
    expect(r.redactedKinds).toContain('email');
  });

  it('strips long hex tokens', () => {
    const r = redactForLlm('token=abcdef0123456789abcdef0123456789ab');
    expect(r.text).toContain('[REDACTED_HEX]');
    expect(r.redactedKinds).toContain('long_hex');
  });

  it('preserves typical Atlassian accountId-like strings (alphanumeric short)', () => {
    const r = redactForLlm('assignee accountId 712020:abc-1');
    expect(r.text).toContain('712020:abc-1');
    expect(r.redactedKinds).toHaveLength(0);
  });

  it('leaves benign sentences unchanged', () => {
    const r = redactForLlm('本月 Sprint 的完成數');
    expect(r.text).toBe('本月 Sprint 的完成數');
    expect(r.redactedKinds).toEqual([]);
  });
});
