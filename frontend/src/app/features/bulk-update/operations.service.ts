// T088：以指數退讓 polling /bulk/operations/{id} 直到 status 終態（success/partial_failure/failure/cancelled）

import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  BulkApiService,
  type BulkOperationResponse,
} from './bulk-api.service';

const TERMINAL: readonly BulkOperationResponse['status'][] = [
  'success',
  'partial_failure',
  'failure',
  'cancelled',
];

@Injectable({ providedIn: 'root' })
export class BulkOperationsPollingService {
  private readonly api = inject(BulkApiService);

  /**
   * 以指數退讓 (initialMs * 2^k，封頂 cap) 輪詢，直到狀態為終態或 totalTimeoutMs。
   * 每次取得最新 snapshot 時呼叫 onUpdate（讓 UI 顯示即時 success/failure 計數）。
   */
  async pollUntilDone(
    operationId: string,
    onUpdate: (snapshot: BulkOperationResponse) => void,
    opts: { initialMs?: number; capMs?: number; totalTimeoutMs?: number } = {},
  ): Promise<BulkOperationResponse> {
    const initial = opts.initialMs ?? 500;
    const cap = opts.capMs ?? 4000;
    const deadline = Date.now() + (opts.totalTimeoutMs ?? 5 * 60_000);

    let wait = initial;
    while (Date.now() < deadline) {
      const snap = await firstValueFrom(this.api.getOperation(operationId));
      onUpdate(snap);
      if (TERMINAL.includes(snap.status)) return snap;
      await delay(wait);
      wait = Math.min(cap, wait * 2);
    }
    throw new Error(`bulk operation ${operationId} polling timed out`);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
