// T041：US2 ServiceLog 詳細頁
// - 完整 summary（不截斷）
// - notes JSON pretty-print
// - 對 CHKPROJ 的 delayed[] / CHKISSUE 的 with_issues/without_issues/empty_streak / errors[]
//   給友善表格呈現（patch T056 之 partial 預先在 detail 提供基礎結構）

import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { I18nService } from '../../core/i18n/i18n.service';
import { LoadingStateComponent } from '../../ui/loading-state/loading-state.component';
import { ErrorStateComponent } from '../../ui/error-state/error-state.component';
import {
  ServiceLogsApiService,
  type ServiceLogDetail,
  type ServiceLogResult,
} from './service-logs-api.service';

type State = 'idle' | 'loading' | 'error' | 'not-found';

@Component({
  selector: 'app-service-log-detail-page',
  standalone: true,
  imports: [RouterLink, LoadingStateComponent, ErrorStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="space-y-4">
      <header class="flex items-center justify-between">
        <h1 class="text-2xl font-semibold text-slate-900">{{ i18n.t('service_logs_detail_title') }}</h1>
        <a routerLink="/service-logs" class="text-sm text-blue-600 hover:underline">
          ← {{ i18n.t('common_back') }}
        </a>
      </header>

      @switch (state()) {
        @case ('loading') { <app-loading-state /> }
        @case ('error') { <app-error-state (retry)="load()" /> }
        @case ('not-found') {
          <div class="rounded-md border border-slate-200 bg-white p-8 text-center">
            <p class="text-slate-600">{{ i18n.t('service_log_not_found') }}</p>
          </div>
        }
        @default {
          @if (detail(); as d) {
            <dl class="rounded-md border border-slate-200 bg-white p-4 grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
              <dt class="text-slate-500">{{ i18n.t('service_logs_table_service') }}</dt>
              <dd class="font-mono">{{ d.serviceId }}</dd>

              <dt class="text-slate-500">{{ i18n.t('service_logs_table_triggered_by') }}</dt>
              <dd>{{ triggeredLabel(d.triggeredBy) }}</dd>

              <dt class="text-slate-500">{{ i18n.t('service_logs_detail_started') }}</dt>
              <dd>{{ d.startedAt }}</dd>

              <dt class="text-slate-500">{{ i18n.t('service_logs_detail_ended') }}</dt>
              <dd>{{ d.endedAt ?? '—' }}</dd>

              <dt class="text-slate-500">{{ i18n.t('service_logs_table_result') }}</dt>
              <dd>{{ resultLabel(d.result) }}</dd>

              @if (d.ruleVersion) {
                <dt class="text-slate-500">{{ i18n.t('service_logs_detail_rule_version') }}</dt>
                <dd class="font-mono">{{ d.ruleVersion }}</dd>
              }

              <dt class="text-slate-500 col-span-2 mt-2">{{ i18n.t('service_logs_detail_summary') }}</dt>
              <dd class="col-span-2 whitespace-pre-wrap">{{ d.summary }}</dd>
            </dl>

            @if (delayed(d).length > 0) {
              <div class="rounded-md border border-slate-200 bg-white p-4">
                <h2 class="text-sm font-semibold text-slate-700 mb-2">
                  {{ i18n.t('service_logs_detail_delayed_projects') }}
                </h2>
                <table class="min-w-full text-sm">
                  <thead class="text-slate-500">
                    <tr>
                      <th class="px-2 py-1 text-left">Project</th>
                      <th class="px-2 py-1 text-left">Conditions</th>
                      <th class="px-2 py-1 text-right">Sprint %</th>
                      <th class="px-2 py-1 text-right">Completion %</th>
                      <th class="px-2 py-1 text-right">Overdue</th>
                      <th class="px-2 py-1 text-right">Max days</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100">
                    @for (dp of delayed(d); track dp.projectKey) {
                      <tr>
                        <td class="px-2 py-1 font-mono">
                          <a [routerLink]="['/dashboard']"
                            [queryParams]="{ projectKey: dp.projectKey }"
                            class="text-blue-600 hover:underline">
                            {{ dp.projectKey }}
                          </a>
                        </td>
                        <td class="px-2 py-1">{{ joinConditions(dp.conditions) }}</td>
                        <td class="px-2 py-1 text-right">{{ percent(dp.sprintProgress) }}</td>
                        <td class="px-2 py-1 text-right">{{ percent(dp.completionRatio) }}</td>
                        <td class="px-2 py-1 text-right">{{ dp.overdueCount }}</td>
                        <td class="px-2 py-1 text-right">{{ dp.maxOverdueDays }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }

            @if (errors(d).length > 0) {
              <div class="rounded-md border border-rose-200 bg-rose-50 p-4">
                <h2 class="text-sm font-semibold text-rose-700 mb-2">
                  {{ i18n.t('service_logs_detail_errors') }}
                </h2>
                <ul class="list-disc list-inside text-sm text-rose-700">
                  @for (e of errors(d); track e.projectKey) {
                    <li>
                      <span class="font-mono">{{ e.projectKey }}</span>: {{ e.message }}
                    </li>
                  }
                </ul>
              </div>
            }

            <div class="rounded-md border border-slate-200 bg-white p-4">
              <h2 class="text-sm font-semibold text-slate-700 mb-2">
                {{ i18n.t('service_logs_detail_notes') }}
              </h2>
              <pre class="rounded bg-slate-50 p-3 text-xs overflow-x-auto">{{ pretty(d.notes) }}</pre>
            </div>
          }
        }
      }
    </section>
  `,
})
export class ServiceLogDetailPageComponent {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(ServiceLogsApiService);
  private readonly route = inject(ActivatedRoute);

  protected readonly detail = signal<ServiceLogDetail | null>(null);
  protected readonly state = signal<State>('loading');

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.state.set('not-found');
      return;
    }
    this.state.set('loading');
    try {
      const d = await firstValueFrom(this.api.get(id));
      this.detail.set(d);
      this.state.set('idle');
    } catch (err) {
      const status = (err as { status?: number })?.status;
      this.state.set(status === 404 ? 'not-found' : 'error');
    }
  }

  resultLabel(r: ServiceLogResult): string {
    return this.i18n.t(`service_logs_result_${r}` as 'service_logs_result_success');
  }

  triggeredLabel(t: 'schedule' | 'manual' | 'system'): string {
    return this.i18n.t(`service_logs_triggered_${t}` as 'service_logs_triggered_schedule');
  }

  pretty(o: unknown): string {
    try {
      return JSON.stringify(o, null, 2);
    } catch {
      return String(o);
    }
  }

  delayed(d: ServiceLogDetail): DelayedEntry[] {
    const arr = (d.notes as { delayed?: unknown }).delayed;
    return Array.isArray(arr) ? (arr as DelayedEntry[]) : [];
  }

  errors(d: ServiceLogDetail): ErrorEntry[] {
    const arr = (d.notes as { errors?: unknown }).errors;
    return Array.isArray(arr) ? (arr as ErrorEntry[]) : [];
  }

  joinConditions(conditions: ('A' | 'B')[]): string {
    return conditions.join(' + ');
  }

  percent(v: number | null): string {
    if (v === null || v === undefined) return '—';
    return `${Math.round(v * 100)}%`;
  }
}

interface DelayedEntry {
  projectKey: string;
  conditions: ('A' | 'B')[];
  sprintProgress: number | null;
  completionRatio: number | null;
  overdueCount: number;
  maxOverdueDays: number;
}

interface ErrorEntry {
  projectKey: string;
  message: string;
  retried?: boolean;
}
