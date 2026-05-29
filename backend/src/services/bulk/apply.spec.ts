// T091：services/bulk/apply 單元測試——token 驗證 / confirm 三方比對 / 各失敗分支
import { describe, it, expect, vi, beforeAll } from 'vitest';
import type { McpSession } from '../../mcp/types';
import { applyBulkUpdate, BulkApplyError } from './apply';
import { signPreviewToken } from './token';
import { generateKeyBase64 } from '../auth/token-crypto';
import type { BulkUpdatesRepo } from '../../db/repositories/bulk-updates';

beforeAll(() => {
  process.env.TOKEN_ENC_KEY = generateKeyBase64();
});

interface MockRepoCalls {
  create: number;
  record: number;
  finalize: number;
  lastStatus: string | undefined;
}

function mockRepo(): BulkUpdatesRepo & { calls: MockRepoCalls } {
  const calls: MockRepoCalls = { create: 0, record: 0, finalize: 0, lastStatus: undefined };
  return {
    calls,
    async createOperation() {
      calls.create += 1;
      return { id: 'op-1' };
    },
    async recordItem() {
      calls.record += 1;
    },
    async finalize(args) {
      calls.finalize += 1;
      calls.lastStatus = args.status;
    },
    async getById() {
      return null;
    },
    async listByUser() {
      return { items: [], nextCursor: null };
    },
  };
}

function mockSession(impl: (issueKey: string) => unknown): McpSession {
  return {
    callTool: vi.fn(async ({ arguments: args }) => ({
      content: impl((args as { issueKey: string }).issueKey),
    })),
  } as unknown as McpSession;
}

function signOk(userId: string, issueKeys: string[], totalCount = issueKeys.length) {
  return signPreviewToken({
    userId,
    projectKey: 'P',
    targetField: 'label',
    targetValueJson: ['x'],
    filterDsl: {},
    issueKeys,
    previousValues: Object.fromEntries(issueKeys.map((k) => [k, []])),
    totalCount,
  });
}

describe('applyBulkUpdate 錯誤分支', () => {
  it('壞 token → token_invalid', async () => {
    await expect(
      applyBulkUpdate({
        userId: 'u',
        previewToken: 'totally-bogus',
        confirmText: '確認更新 1 筆',
        confirmCount: 1,
        session: mockSession(() => ({ ok: true })),
        repo: mockRepo(),
      }),
    ).rejects.toMatchObject({ reason: 'token_invalid' });
  });

  it('user 不符 → token_invalid', async () => {
    const token = signOk('alice', ['P-1']);
    await expect(
      applyBulkUpdate({
        userId: 'bob',
        previewToken: token,
        confirmText: '確認更新 1 筆',
        confirmCount: 1,
        session: mockSession(() => ({ ok: true })),
        repo: mockRepo(),
      }),
    ).rejects.toMatchObject({ reason: 'token_invalid' });
  });

  it('過期 token → token_expired', async () => {
    const token = signPreviewToken(
      {
        userId: 'u',
        projectKey: 'P',
        targetField: 'label',
        targetValueJson: ['x'],
        filterDsl: {},
        issueKeys: ['P-1'],
        previousValues: { 'P-1': [] },
        totalCount: 1,
      },
      Date.now() - 31 * 60 * 1000, // 31 分鐘前
    );
    await expect(
      applyBulkUpdate({
        userId: 'u',
        previewToken: token,
        confirmText: '確認更新 1 筆',
        confirmCount: 1,
        session: mockSession(() => ({ ok: true })),
        repo: mockRepo(),
      }),
    ).rejects.toMatchObject({ reason: 'token_expired' });
  });

  it('confirmText 不符 → confirm_text_invalid', async () => {
    const token = signOk('u', ['P-1']);
    await expect(
      applyBulkUpdate({
        userId: 'u',
        previewToken: token,
        confirmText: 'I confirm',
        confirmCount: 1,
        session: mockSession(() => ({ ok: true })),
        repo: mockRepo(),
      }),
    ).rejects.toMatchObject({ reason: 'confirm_text_invalid' });
  });

  it('confirmCount 與 token totalCount 不符 → confirm_count_mismatch', async () => {
    const token = signOk('u', ['P-1', 'P-2']);
    await expect(
      applyBulkUpdate({
        userId: 'u',
        previewToken: token,
        confirmText: '確認更新 5 筆',
        confirmCount: 5,
        session: mockSession(() => ({ ok: true })),
        repo: mockRepo(),
      }),
    ).rejects.toMatchObject({ reason: 'confirm_count_mismatch' });
  });

  it('issueKeys 為空 → no_editable_items', async () => {
    const token = signOk('u', [], 0);
    await expect(
      applyBulkUpdate({
        userId: 'u',
        previewToken: token,
        confirmText: '確認更新 0 筆',
        confirmCount: 0,
        session: mockSession(() => ({ ok: true })),
        repo: mockRepo(),
      }),
    ).rejects.toMatchObject({ reason: 'no_editable_items' });
  });
});

describe('applyBulkUpdate 成功與部分失敗', () => {
  it('全成功 → finalize success', async () => {
    const token = signOk('u', ['P-1', 'P-2']);
    const repo = mockRepo();
    const session = mockSession(() => ({ ok: true }));
    const r = await applyBulkUpdate({
      userId: 'u',
      previewToken: token,
      confirmText: '確認更新 2 筆',
      confirmCount: 2,
      session,
      repo,
    });
    await r.done;
    expect(repo.calls.lastStatus).toBe('success');
    expect(repo.calls.record).toBe(2);
  });

  it('部分失敗 → finalize partial_failure', async () => {
    const token = signOk('u', ['P-1', 'P-2', 'P-3']);
    const repo = mockRepo();
    const session = mockSession((k) =>
      k === 'P-2'
        ? { ok: false, error: { code: 'permission_denied', message: 'no' } }
        : { ok: true },
    );
    const r = await applyBulkUpdate({
      userId: 'u',
      previewToken: token,
      confirmText: '確認更新 3 筆',
      confirmCount: 3,
      session,
      repo,
    });
    await r.done;
    expect(repo.calls.lastStatus).toBe('partial_failure');
  });

  it('全失敗 → finalize failure（MCP 拋例外也算 api_error）', async () => {
    const token = signOk('u', ['P-1', 'P-2']);
    const repo = mockRepo();
    const session = {
      callTool: vi.fn(async () => {
        throw new Error('mcp down');
      }),
    } as unknown as McpSession;
    const r = await applyBulkUpdate({
      userId: 'u',
      previewToken: token,
      confirmText: '確認更新 2 筆',
      confirmCount: 2,
      session,
      repo,
    });
    await r.done;
    expect(repo.calls.lastStatus).toBe('failure');
  });
});

describe('BulkApplyError', () => {
  it('保留 reason + detail', () => {
    const e = new BulkApplyError('token_expired', 'oops');
    expect(e.reason).toBe('token_expired');
    expect(e.message).toBe('oops');
  });
});
