import { describe, it, expect } from 'vitest';
import { nextRunAt } from './cleanup';

describe('cleanup nextRunAt', () => {
  it('schedules to today 03:00 if before 03:00', () => {
    const now = new Date('2026-05-27T01:00:00');
    const next = nextRunAt(now);
    expect(next.getDate()).toBe(now.getDate());
    expect(next.getHours()).toBe(3);
  });

  it('schedules to tomorrow 03:00 if already past 03:00', () => {
    const now = new Date('2026-05-27T10:00:00');
    const next = nextRunAt(now);
    expect(next.getDate()).toBe(now.getDate() + 1);
    expect(next.getHours()).toBe(3);
  });
});
