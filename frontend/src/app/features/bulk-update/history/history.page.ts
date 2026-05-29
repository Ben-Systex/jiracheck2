// T113：US4 批次更新歷史頁
// - 篩選 projectKey / status；分頁 cursor + 載入更多
// - 列表每行可點開至 /bulk/operations/{id} 詳細

import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { I18nService } from '../../../core/i18n/i18n.service';
import { ButtonComponent } from '../../../ui/button/button.component';
import { LoadingStateComponent } from '../../../ui/loading-state/loading-state.component';
import { EmptyStateComponent } from '../../../ui/empty-state/empty-state.component';
import {
  BulkApiService,
  type BulkOperationStatus,
  type BulkOperationSummary,
} from '../bulk-api.service';

const STATUSES: readonly { key: BulkOperationStatus; label: string }[] = [
  { key: 'running', label: '執行中' },
  { key: 'success', label: '成功' },
  { key: 'partial_failure', label: '部分失敗' },
  { key: 'failure', label: '失敗' },
  { key: 'cancelled', label: '取消' },
];

@Component({
  selector: 'app-bulk-history-page',
  standalone: true,
  imports: [FormsModule, ButtonComponent, LoadingStateComponent, EmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="space-y-4">
      <header>
        <h1 class="text-2xl font-semibold text-slate-900">{{ i18n.t('bulk_history_title') }}</h1>
        <p class="mt-1 text-sm text-slate-600">{{ i18n.t('bulk_history_subtitle') }}</p>
      </header>

      <form class="flex flex-wrap items-end gap-3 rounded-md bg-slate-50 p-3" (submit)="onFilter($event)">
        <label class="block text-sm">
          <span class="block text-slate-700">{{ i18n.t('bulk_history_filter_project') }}</span>
          <input
            type="text"
            class="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            [(ngModel)]="projectKey"
            name="projectKey"
            placeholder="PAY"
          />
        </label>
        <label class="block text-sm">
          <span class="block text-slate-700">{{ i18n.t('bulk_history_filter_status') }}</span>
          <select
            class="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm bg-white"
            [(ngModel)]="status"
            name="status"
          >
            <option [ngValue]="''">—</option>
            @for (s of statuses; track s.key) {
              <option [ngValue]="s.key">{{ s.label }}</option>
            }
          </select>
        </label>
        <app-button type="submit" variant="primary" size="sm">{{ i18n.t('bulk_history_apply_filter') }}</app-button>
      </form>

      @if (loading()) { <app-loading-state /> }
      @if (!loading() && items().length === 0) {
        <app-empty-state
          [title]="i18n.t('bulk_history_empty_title')"
          [description]="i18n.t('bulk_history_empty_description')"
        />
      }
      @if (items().length > 0) {
        <div class="overflow-x-auto rounded-md border border-slate-200">
          <table class="min-w-full divide-y divide-slate-200 text-sm">
            <thead class="bg-slate-50">
              <tr>
                <th class="px-3 py-2 text-left text-xs font-semibold text-slate-600">{{ i18n.t('bulk_history_table_at') }}</th>
                <th class="px-3 py-2 text-left text-xs font-semibold text-slate-600">{{ i18n.t('bulk_history_table_project') }}</th>
                <th class="px-3 py-2 text-left text-xs font-semibold text-slate-600">{{ i18n.t('bulk_history_table_field') }}</th>
                <th class="px-3 py-2 text-left text-xs font-semibold text-slate-600">{{ i18n.t('bulk_history_table_total') }}</th>
                <th class="px-3 py-2 text-left text-xs font-semibold text-slate-600">{{ i18n.t('bulk_history_table_status') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 bg-white">
              @for (row of items(); track row.id) {
                <tr>
                  <td class="px-3 py-2 align-top text-slate-800">{{ row.startedAt }}</td>
                  <td class="px-3 py-2 align-top text-slate-800">{{ row.projectKey }}</td>
                  <td class="px-3 py-2 align-top text-slate-800">{{ row.targetField }}</td>
                  <td class="px-3 py-2 align-top text-slate-800">{{ row.totalCount }}</td>
                  <td class="px-3 py-2 align-top">
                    <span class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                      {{ row.status }}
                    </span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        @if (nextCursor()) {
          <app-button variant="secondary" size="sm" (click)="loadMore()">{{ i18n.t('bulk_history_load_more') }}</app-button>
        }
      }
    </section>
  `,
})
export class BulkHistoryPageComponent {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(BulkApiService);

  protected projectKey = '';
  protected status: BulkOperationStatus | '' = '';
  protected readonly statuses = STATUSES;

  protected readonly items = signal<BulkOperationSummary[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly loading = signal(false);

  constructor() {
    void this.load(true);
  }

  onFilter(event: Event): void {
    event.preventDefault();
    void this.load(true);
  }

  async loadMore(): Promise<void> {
    await this.load(false);
  }

  private async load(reset: boolean): Promise<void> {
    this.loading.set(true);
    const cursor = reset ? undefined : this.nextCursor() ?? undefined;
    try {
      const res = await firstValueFrom(
        this.api.listOperations({
          ...(this.projectKey ? { projectKey: this.projectKey.trim() } : {}),
          ...(this.status ? { status: this.status } : {}),
          ...(cursor ? { cursor } : {}),
          pageSize: 20,
        }),
      );
      this.items.set(reset ? res.items : [...this.items(), ...res.items]);
      this.nextCursor.set(res.nextCursor);
    } finally {
      this.loading.set(false);
    }
  }
}
