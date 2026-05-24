// server-side session 管理（research R-006）
// - sid 為 256-bit 隨機字串（HTTP-only cookie）
// - sliding expiration：每次活動延 7 天
// - access token 不入庫；session 只記錄 user 與會話 metadata

import { randomBytes } from 'node:crypto';
import type { Pool } from 'pg';

export const SESSION_COOKIE_NAME = 'sid';
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SessionRecord {
  sid: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  lastSeenAt: Date;
}

export function generateSid(): string {
  return randomBytes(32).toString('base64url');
}

export async function createSession(
  pool: Pool,
  userId: string,
  meta: { userAgent?: string; ip?: string } = {},
): Promise<SessionRecord> {
  const sid = generateSid();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + DEFAULT_TTL_MS);
  await pool.query(
    `INSERT INTO sessions (sid, user_id, created_at, expires_at, last_seen_at, user_agent, ip_inet)
     VALUES ($1, $2, $3, $4, $3, $5, $6)`,
    [sid, userId, now, expiresAt, meta.userAgent ?? null, meta.ip ?? null],
  );
  return { sid, userId, createdAt: now, expiresAt, lastSeenAt: now };
}

export async function touchSession(pool: Pool, sid: string): Promise<SessionRecord | undefined> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + DEFAULT_TTL_MS);
  const { rows } = await pool.query<{
    sid: string;
    user_id: string;
    created_at: Date;
    expires_at: Date;
    last_seen_at: Date;
  }>(
    `UPDATE sessions
     SET last_seen_at = $2, expires_at = $3
     WHERE sid = $1 AND expires_at > $2
     RETURNING sid, user_id, created_at, expires_at, last_seen_at`,
    [sid, now, expiresAt],
  );
  const row = rows[0];
  if (!row) return undefined;
  return {
    sid: row.sid,
    userId: row.user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
  };
}

export async function destroySession(pool: Pool, sid: string): Promise<void> {
  await pool.query(`DELETE FROM sessions WHERE sid = $1`, [sid]);
}

export async function pruneExpiredSessions(pool: Pool): Promise<number> {
  const { rowCount } = await pool.query(`DELETE FROM sessions WHERE expires_at <= now()`);
  return rowCount ?? 0;
}
