// T067：US3 統計卡 — 計畫 SP vs Actual SP 折線 + 完成數依專案柱狀
// - 採 ng2-charts（已於 app.config provideCharts 註冊）
// - OnPush + signals；輸入為 PersonStatsResponse

import {
  ChangeDetectionStrategy,
  Component,
  Input,
  computed,
  inject,
  signal,
} from '@angular/core';
import { BaseChartDirective } from 'ng2-charts';
import type { ChartConfiguration } from 'chart.js';
import { I18nService } from '../../../core/i18n/i18n.service';
import type {
  PersonStatsResponse,
  PersonStatsByProject,
} from '../people-api.service';

@Component({
  selector: 'app-stats-card',
  standalone: true,
  imports: [BaseChartDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (stats(); as s) {
      <section class="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <header>
          <h3 class="text-base font-semibold text-slate-900">{{ i18n.t('people_stats_heading') }}</h3>
          <p class="mt-0.5 text-xs text-slate-500">
            {{ i18n.t('people_stats_from_to', { from: s.from, to: s.to }) }}
          </p>
        </header>

        <dl class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <dt class="text-xs text-slate-500">{{ i18n.t('people_stats_completed') }}</dt>
            <dd class="mt-0.5 text-xl font-semibold text-slate-900">{{ s.totals.completedCount }}</dd>
          </div>
          <div>
            <dt class="text-xs text-slate-500">{{ i18n.t('people_stats_sp') }}</dt>
            <dd class="mt-0.5 text-xl font-semibold text-slate-900">{{ s.totals.storyPointsSum }}</dd>
          </div>
          <div>
            <dt class="text-xs text-slate-500">{{ i18n.t('people_stats_actual_sp') }}</dt>
            <dd class="mt-0.5 text-xl font-semibold text-slate-900">{{ s.totals.actualStoryPointsSum }}</dd>
          </div>
          <div>
            <dt class="text-xs text-slate-500">{{ i18n.t('people_stats_accuracy') }}</dt>
            <dd class="mt-0.5 text-xl font-semibold text-slate-900">
              @if (s.totals.estimateAccuracyRatio !== null) {
                {{ s.totals.estimateAccuracyRatio }}
              } @else {
                <span class="text-sm font-normal text-slate-500">{{ i18n.t('people_stats_accuracy_na') }}</span>
              }
            </dd>
          </div>
        </dl>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <p class="text-xs font-medium text-slate-700">{{ i18n.t('people_chart_sp_vs_actual') }}</p>
            <div class="mt-2 h-48">
              <canvas
                baseChart
                [data]="lineData()"
                [options]="lineOptions"
                [type]="'line'"
                [attr.aria-label]="i18n.t('people_chart_sp_vs_actual')"
              ></canvas>
            </div>
          </div>
          <div>
            <p class="text-xs font-medium text-slate-700">{{ i18n.t('people_chart_by_project') }}</p>
            <div class="mt-2 h-48">
              <canvas
                baseChart
                [data]="barData()"
                [options]="barOptions"
                [type]="'bar'"
                [attr.aria-label]="i18n.t('people_chart_by_project')"
              ></canvas>
            </div>
          </div>
        </div>

        <section>
          <h4 class="text-xs font-semibold text-slate-700">{{ i18n.t('people_stats_by_project') }}</h4>
          <ul class="mt-2 divide-y divide-slate-100 text-sm">
            @for (row of s.byProject; track row.projectKey) {
              <li class="flex justify-between py-1.5">
                <span class="font-medium text-slate-800">{{ row.projectKey }}</span>
                <span class="text-slate-600">
                  {{ row.completedCount }} 件 / SP {{ row.storyPointsSum }} / Actual {{ row.actualStoryPointsSum }}
                </span>
              </li>
            }
          </ul>
        </section>
      </section>
    }
  `,
})
export class StatsCardComponent {
  protected readonly i18n = inject(I18nService);
  private readonly _stats = signal<PersonStatsResponse | null>(null);

  @Input({ required: true })
  set statsInput(value: PersonStatsResponse | null) {
    this._stats.set(value);
  }

  stats = computed<PersonStatsResponse | null>(() => this._stats());

  lineOptions: ChartConfiguration<'line'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom' } },
    scales: { y: { beginAtZero: true } },
  };

  barOptions: ChartConfiguration<'bar'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: { y: { beginAtZero: true } },
  };

  lineData = computed<ChartConfiguration<'line'>['data']>(() => {
    const rows = this._stats()?.byProject ?? [];
    return {
      labels: rows.map((r) => r.projectKey),
      datasets: [
        { label: 'SP', data: rows.map((r) => r.storyPointsSum), borderColor: '#2563eb', backgroundColor: '#2563eb' },
        { label: 'Actual SP', data: rows.map((r) => r.actualStoryPointsSum), borderColor: '#f59e0b', backgroundColor: '#f59e0b' },
      ],
    };
  });

  barData = computed<ChartConfiguration<'bar'>['data']>(() => {
    const rows: PersonStatsByProject[] = this._stats()?.byProject ?? [];
    return {
      labels: rows.map((r) => r.projectKey),
      datasets: [
        {
          data: rows.map((r) => r.completedCount),
          backgroundColor: '#0ea5e9',
          borderWidth: 0,
        },
      ],
    };
  });
}
