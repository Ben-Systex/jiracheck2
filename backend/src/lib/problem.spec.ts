import { describe, it, expect } from 'vitest';
import { buildProblem } from './problem';

describe('problem builder', () => {
  it('maps cause to correct HTTP status', () => {
    expect(buildProblem('not_found').status).toBe(404);
    expect(buildProblem('unauthorized').status).toBe(401);
    expect(buildProblem('rate_limited').status).toBe(429);
    expect(buildProblem('upstream').status).toBe(502);
  });

  it('uses i18n message for title when messageKey supplied', () => {
    const p = buildProblem('not_found', { messageKey: 'project_not_found' });
    expect(p.title).toContain('找不到');
    expect(p.cause).toBe('not_found');
  });

  it('omits detail field when not provided', () => {
    const p = buildProblem('validation', { messageKey: 'error_validation' });
    expect('detail' in p).toBe(false);
  });

  it('includes detail when provided', () => {
    const p = buildProblem('validation', { detail: 'foo' });
    expect(p.detail).toBe('foo');
  });
});
