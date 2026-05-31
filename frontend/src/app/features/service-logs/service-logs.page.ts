// T040：US2 ServiceLogs 列表頁
// - 過濾：serviceId / result / from / to（預設最近 7 天）
// - cursor 分頁「載入更多」
// - 匯出 CSV：開新分頁帶相同過濾條件

import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { I18nService } from '../../core/i18n/i18n.service';
import { ButtonComponent } from '../../ui/button/button.component';
import { LoadingStateComponent } from '../../ui/loading-state/loading-state.component';
import { EmptyStateComponent } from '../../ui/empty-state/empty-state.component';
import { ErrorStateComponent } from '../../ui/error-state/error-state.component';
import {
  ServiceLogsApiService,
  type ExtendedServiceId,
  type ServiceLogResult,
  type ServiceLogSummary,
} from './service-logs-api.service';

type State = 'idle' | 'loading' | 'error';

const SERVICE_IDS: readonly ExtendedServiceId[] = ['CHKPROJ', 'CHKISSUE', 'SYSTEM_CLEANUP'];
const RESULTS: readonly ServiceLogResult[] = [
  'success',
  'partial_failure',
  'failure',
  'skipped',
  'missed',
];

@Component({
  selector: 'app-service-logs-page',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    ButtonComponent,
    LoadingStateComponent,
    EmptyStateComponent,
    ErrorStateComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="space-y-4">
      <header>
        <h1 class="text-2xl font-semibold text-slate-900">{{ i18n.t('service_logs_title') }}</h1>
        <p class="mt-1 text-sm text-slate-600">{{ i18n.t('service_logs_subtitle') }}</p>
      </header>

      <form class="flex flex-wrap items-end gap-3 rounded-md bg-slate-50 p-3" (submit)="onFilter($event)">
        <label class="block text-sm">
          <span class="block text-slate-700">{{ i18n.t('service_logs_filter_service') }}</span>
          <select class="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm bg-white"
            [(ngModel)]="serviceId" name="serviceId">
            <option value="">—</option>
            @for (s of serviceIds; track s) {
              <option [value]="s">{{ s }}</option>
            }
          </select>
        </label>
        <label class="block text-sm">
          <span class="block text-slate-700">{{ i18n.t('service_logs_filter_result') }}</span>
          <select class="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm bg-white"
            [(ngModel)]="result" name="result">
            <option value="">—</option>
            @for (r of resultOptions; track r) {
              <option [value]="r">{{ resultLabel(r) }}</option>
            }
          </select>
        </label>
        <label class="block text-sm">
          <span class="block text-slate-700">{{ i18n.t('service_logs_filter_from') }}</span>
          <input type="datetime-local" class="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            [(ngModel)]="from" name="from" />
        </label>
        <label class="block text-sm">
          <span class="block text-slate-700">{{ i18n.t('service_logs_filter_to') }}</span>
          <input type="datetime-local" class="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            [(ngModel)]="to" name="to" />
        </label>
        <app-button type="submit">{{ i18n.t('service_logs_filter_apply') }}</app-button>
        <button type="button" class="text-sm text-slate-500 hover:text-slate-700"
          (click)="onReset()">
          {{ i18n.t('service_logs_filter_reset') }}
        </button>
        <a [href]="exportHref()" target="_blank" rel="noopener"
          class="ml-auto rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100">
          {{ i18n.t('service_logs_export_csv') }}
        </a>
      </form>

      @switch (state()) {
        @case ('loading') { <app-loading-state /> }
        @case ('error') { <app-error-state (retry)="reload()" /> }
        @default {
          @if (items().length === 0) {
            <app-empty-state
              [title]="i18n.t('service_logs_empty_title')"
              [description]="i18n.t('service_logs_empty_description')"
            />
          } @else {
            <div class="overflow-x-auto rounded-md border border-slate-200 bg-white">
              <table class="min-w-full divide-y divide-slate-200 text-sm">
                <thead class="bg-slate-50">
                  <tr>
                    <th class="px-3 py-2 text-left">{{ i18n.t('service_logs_table_at') }}</th>
                    <th class="px-3 py-2 text-left">{{ i18n.t('service_logs_table_service') }}</th>
                    <th class="px-3 py-2 text-left">{{ i18n.t('service_logs_table_triggered_by') }}</th>
                    <th class="px-3 py-2 text-left">{{ i18n.t('service_logs_table_result') }}</th>
                    <th class="px-3 py-2 text-left">{{ i18n.t('service_logs_table_summary') }}</th>
                    <th class="px-3 py-2 text-right">{{ i18n.t('service_logs_table_actions') }}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  @for (it of items(); track it.id) {
                    <tr>
                      <td class="px-3 py-2 text-slate-600">{{ it.startedAt }}</td>
                      <td class="px-3 py-2 font-medium">{{ it.serviceId }}</td>
                      <td class="px-3 py-2">{{ triggeredLabel(it.triggeredBy) }}</td>
                      <td class="px-3 py-2">
                        <span class="rounded-full px-2 py-0.5 text-xs"
                          [class.bg-green-100]="it.result === 'success'"
                          [class.text-green-700]="it.result === 'success'"
                          [class.bg-yellow-100]="it.result === 'partial_failure'"
                          [class.text-yellow-700]="it.result === 'partial_failure'"
                          [class.bg-rose-100]="it.result === 'failure' || it.result === 'missed'"
                          [class.text-rose-700]="it.result === 'failure' || it.result === 'missed'"
                          [class.bg-slate-100]="it.result === 'skipped'"
                          [class.text-slate-600]="it.result === 'skipped'">
                          {{ resultLabel(it.result) }}
                        </span>
                      </td>
                      <td class="px-3 py-2 text-slate-700">{{ it.summary }}</td>
                      <td class="px-3 py-2 text-right">
                        <a [routerLink]="['/service-logs', it.id]"
                          class="text-blue-600 hover:underline">
                          {{ i18n.t('service_logs_action_detail') }}
                        </a>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            @if (nextCursor()) {
              <div class="flex justify-center pt-2">
                <app-button variant="ghost" (click)="onLoadMore()">{{ i18n.t('service_logs_load_more') }}</app-button>
              </div>
            }
          }
        }
      }
    </section>
  `,
})
export class ServiceLogsPageComponent {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(ServiceLogsApiService);

  protected readonly serviceIds = SERVICE_IDS;
  protected readonly resultOptions = RESULTS;

  serviceId = '';
  result = '';
  from = '';
  to = '';

  protected readonly items = signal<ServiceLogSummary[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly state = signal<State>('loading');

  constructor() {
    void this.reload();
  }

  resultLabel(r: ServiceLogResult): string {
    return this.i18n.t(`service_logs_result_${r}` as 'service_logs_result_success');
  }

  triggeredLabel(t: 'schedule' | 'manual' | 'system'): string {
    return this.i18n.t(`service_logs_triggered_${t}` as 'service_logs_triggered_schedule');
  }

  onFilter(ev: Event): void {
    ev.preventDefault();
    void this.reload();
  }

  onReset(): void {
    this.serviceId = '';
    this.result = '';
    this.from = '';
    this.to = '';
    void this.reload();
  }

  async reload(): Promise<void> {
    this.state.set('loading');
    this.items.set([]);
    this.nextCursor.set(null);
    try {
      const res = await firstValueFrom(this.api.list(this.buildFilter()));
      this.items.set(res.items);
      this.nextCursor.set(res.nextCursor);
      this.state.set('idle');
    } catch {
      this.state.set('error');
    }
  }

  async onLoadMore(): Promise<void> {
    const cur = this.nextCursor();
    if (!cur) return;
    try {
      const res = await firstValueFrom(this.api.list({ ...this.buildFilter(), cursor: cur }));
      this.items.set([...this.items(), ...res.items]);
      this.nextCursor.set(res.nextCursor);
    } catch {
      this.state.set('error');
    }
  }

  exportHref(): string {
    return this.api.exportUrl(this.buildFilterForExport());
  }

  private buildFilter(): Parameters<ServiceLogsApiService['list']>[0] {
    const f: Parameters<ServiceLogsApiService['list']>[0] = {};
    if (this.serviceId) f.serviceId = this.serviceId as ExtendedServiceId;
    if (this.result) f.result = this.result as ServiceLogResult;
    if (this.from) f.from = new Date(this.from).toISOString();
    if (this.to) f.to = new Date(this.to).toISOString();
    return f;
  }

  private buildFilterForExport(): Parameters<ServiceLogsApiService['exportUrl']>[0] {
    return this.buildFilter();
  }
}
