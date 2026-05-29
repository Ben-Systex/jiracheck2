// T084 + T089 + T090：US4 bulk update 主頁（stepper：條件 → 預覽 → 確認 → 結果）
// - filter-form / preview-table / confirm-dialog / operations-polling 串接
// - 結果頁顯示成功/失敗 + 下載 CSV（client-side 組）
// - 任何錯誤透過 ProblemErrorInterceptor 已處理；本頁顯示 errorMessage signal

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { I18nService } from '../../core/i18n/i18n.service';
import { ButtonComponent } from '../../ui/button/button.component';
import { LoadingStateComponent } from '../../ui/loading-state/loading-state.component';
import { ErrorStateComponent } from '../../ui/error-state/error-state.component';
import { BulkFilterFormComponent } from './filter-form/filter-form.component';
import { BulkPreviewTableComponent } from './preview-table/preview-table.component';
import { BulkConfirmDialogComponent } from './confirm-dialog/confirm-dialog.component';
import {
  BulkApiService,
  type BulkApplyRequest,
  type BulkOperationResponse,
  type BulkPreviewRequest,
  type BulkPreviewResponse,
} from './bulk-api.service';
import { BulkOperationsPollingService } from './operations.service';

type Step = 'filter' | 'preview' | 'confirm' | 'done';

@Component({
  selector: 'app-bulk-update-page',
  standalone: true,
  imports: [
    ButtonComponent,
    LoadingStateComponent,
    ErrorStateComponent,
    BulkFilterFormComponent,
    BulkPreviewTableComponent,
    BulkConfirmDialogComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="space-y-4">
      <header>
        <h1 class="text-2xl font-semibold text-slate-900">{{ i18n.t('bulk_title') }}</h1>
        <p class="mt-1 text-sm text-slate-600">{{ i18n.t('bulk_subtitle') }}</p>
      </header>

      <ol role="list" class="flex flex-wrap items-center gap-2 text-xs">
        @for (s of stepperLabels(); track s.key) {
          <li
            class="rounded-full px-3 py-1"
            [class.bg-blue-600]="s.key === step()"
            [class.text-white]="s.key === step()"
            [class.bg-slate-100]="s.key !== step()"
            [class.text-slate-600]="s.key !== step()"
            [attr.aria-current]="s.key === step() ? 'step' : null"
          >{{ s.label }}</li>
        }
      </ol>

      @if (loading()) { <app-loading-state /> }
      @if (errorMessage(); as msg) {
        <app-error-state [description]="msg" (retry)="onRetry()" />
      }

      @switch (step()) {
        @case ('filter') {
          <app-bulk-filter-form (submitted)="onPreview($event)" />
        }
        @case ('preview') {
          @if (preview(); as p) {
            <app-bulk-preview-table
              [items]="p.items"
              [totalCount]="p.totalCount"
              [previewAt]="previewAt()"
              (back)="step.set('filter')"
              (repreview)="onPreview(lastReq()!)"
              (apply)="step.set('confirm')"
            />
          }
        }
        @case ('confirm') {
          @if (preview(); as p) {
            <app-bulk-confirm-dialog
              [totalCount]="p.totalCount"
              (cancelled)="step.set('preview')"
              (confirmed)="onApply($event)"
            />
          }
        }
        @case ('done') {
          @if (operation(); as op) {
            <section class="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <header class="flex items-baseline justify-between">
                <h2 class="text-lg font-semibold text-slate-900">{{ i18n.t('bulk_done_title') }}</h2>
                <a
                  class="text-sm text-blue-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  [href]="csvHref()"
                  [download]="csvFilename()"
                >{{ i18n.t('bulk_done_csv') }}</a>
              </header>
              <p class="text-sm text-slate-700">{{ statusLine() }}</p>
              <ul class="divide-y divide-slate-100 text-sm">
                @for (item of op.items; track item.issueKey) {
                  <li class="flex items-center justify-between py-1.5">
                    <span class="font-medium text-slate-800">{{ item.issueKey }}</span>
                    <span
                      class="text-xs"
                      [class.text-emerald-700]="item.result === 'success'"
                      [class.text-red-700]="item.result !== 'success'"
                    >
                      {{ item.result }}
                      @if (item.errorMessage) {<span class="ml-1 text-slate-500">— {{ item.errorMessage }}</span>}
                    </span>
                  </li>
                }
              </ul>
              <app-button variant="secondary" (click)="reset()">{{ i18n.t('bulk_back') }}</app-button>
            </section>
          }
        }
      }
    </section>
  `,
})
export class BulkUpdatePageComponent {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(BulkApiService);
  private readonly polling = inject(BulkOperationsPollingService);

  protected readonly step = signal<Step>('filter');
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | undefined>(undefined);

  protected readonly preview = signal<BulkPreviewResponse | null>(null);
  protected readonly previewAt = signal<string | null>(null);
  protected readonly lastReq = signal<BulkPreviewRequest | null>(null);

  protected readonly operation = signal<BulkOperationResponse | null>(null);

  protected readonly stepperLabels = computed(() => [
    { key: 'filter' as Step, label: this.i18n.t('bulk_step_filter') },
    { key: 'preview' as Step, label: this.i18n.t('bulk_step_preview') },
    { key: 'confirm' as Step, label: this.i18n.t('bulk_step_confirm') },
    { key: 'done' as Step, label: this.i18n.t('bulk_step_done') },
  ]);

  protected readonly statusLine = computed<string>(() => {
    const op = this.operation();
    if (!op) return '';
    switch (op.status) {
      case 'running':
        return this.i18n.t('bulk_done_status_running');
      case 'success':
        return this.i18n.t('bulk_done_status_success', { n: op.successCount });
      case 'failure':
      case 'cancelled':
        return this.i18n.t('bulk_done_status_failure', { n: op.failureCount });
      case 'partial_failure':
        return this.i18n.t('bulk_done_status_partial', { ok: op.successCount, fail: op.failureCount });
    }
  });

  protected readonly csvHref = computed<string>(() => {
    const op = this.operation();
    if (!op) return '';
    const header = 'issueKey,result,errorMessage,appliedAt\n';
    const body = op.items
      .map((i) =>
        [csvCell(i.issueKey), csvCell(i.result), csvCell(i.errorMessage ?? ''), csvCell(i.appliedAt ?? '')].join(','),
      )
      .join('\n');
    return `data:text/csv;charset=utf-8,${encodeURIComponent(header + body)}`;
  });

  protected readonly csvFilename = computed<string>(() => {
    const op = this.operation();
    return op ? `bulk-${op.id}.csv` : 'bulk.csv';
  });

  async onPreview(req: BulkPreviewRequest): Promise<void> {
    this.lastReq.set(req);
    this.loading.set(true);
    this.errorMessage.set(undefined);
    try {
      const res = await firstValueFrom(this.api.preview(req));
      this.preview.set(res);
      this.previewAt.set(new Date().toLocaleString('zh-Hant-TW'));
      this.step.set('preview');
    } catch (err) {
      this.errorMessage.set(extractMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  async onApply(payload: { confirmText: string; confirmCount: number }): Promise<void> {
    const tok = this.preview()?.previewToken;
    if (!tok) return;
    const req: BulkApplyRequest = { previewToken: tok, ...payload };
    this.loading.set(true);
    this.errorMessage.set(undefined);
    try {
      const res = await firstValueFrom(this.api.apply(req));
      this.step.set('done');
      // 先 placeholder running，再 polling 拉新
      this.operation.set({
        id: res.operationId,
        status: 'running',
        totalCount: this.preview()!.totalCount,
        successCount: 0,
        failureCount: 0,
        startedAt: new Date().toISOString(),
        completedAt: null,
        items: [],
      });
      await this.polling.pollUntilDone(res.operationId, (snap) => this.operation.set(snap));
    } catch (err) {
      this.errorMessage.set(extractMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  onRetry(): void {
    const req = this.lastReq();
    if (req) void this.onPreview(req);
  }

  reset(): void {
    this.preview.set(null);
    this.previewAt.set(null);
    this.operation.set(null);
    this.lastReq.set(null);
    this.errorMessage.set(undefined);
    this.step.set('filter');
  }
}

function csvCell(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function extractMessage(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'title' in err) {
    return String((err as { title: unknown }).title);
  }
  return undefined;
}
