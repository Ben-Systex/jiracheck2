// T037：US1 專案卡片
// - 顯示專案名、key、未完成數、Sprint Story Points 完成 doughnut
// - 點擊整張卡片 = 進入 /projects/:key
// - 鍵盤可用（role=link + tabindex=0；Enter / Space 觸發）
// - ng2-charts: lazy 註冊已在 app.config（provideCharts(withDefaultRegisterables)）

import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  computed,
  inject,
  signal,
} from '@angular/core';
import { BaseChartDirective } from 'ng2-charts';
import type { ChartConfiguration } from 'chart.js';
import { I18nService } from '../../core/i18n/i18n.service';
import type { ProjectCard, SprintProgress } from '../../features/dashboard/projects-api.service';

@Component({
  selector: 'app-project-card',
  standalone: true,
  imports: [BaseChartDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article
      role="link"
      tabindex="0"
      class="rounded-lg border border-slate-200 bg-white shadow-sm p-4 hover:border-blue-400 hover:shadow-md cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      [attr.aria-label]="i18n.t('dashboard_card_open_aria', { name: project().name })"
      (click)="emitOpen()"
      (keydown.enter)="onKeyboardActivate($event)"
      (keydown.space)="onKeyboardActivate($event)"
    >
      <header class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="text-xs uppercase tracking-wide text-slate-500">{{ project().key }}</p>
          <h3 class="mt-0.5 text-base font-semibold text-slate-900 truncate">
            {{ project().name }}
          </h3>
        </div>
        @if (project().avatarUrl) {
          <img
            [src]="project().avatarUrl!"
            alt=""
            class="h-8 w-8 rounded-md object-cover"
          />
        }
      </header>
      <p class="mt-3 text-sm text-slate-700">
        {{ i18n.t('dashboard_card_open_issues', { n: project().openIssueCount }) }}
      </p>
      @if (sprint(); as sp) {
        <div class="mt-3 flex items-center gap-3">
          <div class="w-16 h-16 shrink-0">
            <canvas
              baseChart
              [data]="chartData()"
              [options]="chartOptions"
              [type]="'doughnut'"
              [attr.aria-label]="i18n.t('dashboard_card_sprint_progress', { done: sp.completedSP, total: sp.totalSP })"
            ></canvas>
          </div>
          <div class="text-xs text-slate-600">
            <p>{{ i18n.t('dashboard_card_sprint_progress', { done: sp.completedSP, total: sp.totalSP }) }}</p>
            @if (sp.sprintName) {
              <p class="mt-0.5 text-slate-500">{{ sp.sprintName }}</p>
            }
          </div>
        </div>
      } @else {
        <p class="mt-3 text-xs text-slate-500">{{ i18n.t('dashboard_card_sprint_none') }}</p>
      }
      @if (project().lastAccessedAt) {
        <p class="mt-3 text-xs text-slate-400">
          {{ i18n.t('dashboard_card_last_accessed', { when: relativeLastAccessed() }) }}
        </p>
      }
    </article>
  `,
})
export class ProjectCardComponent {
  protected readonly i18n = inject(I18nService);
  private readonly _project = signal<ProjectCard | null>(null);

  @Output() open = new EventEmitter<string>();

  @Input({ required: true })
  set projectInput(value: ProjectCard) {
    this._project.set(value);
  }

  project = computed<ProjectCard>(() => this._project()!);
  sprint = computed<SprintProgress | null>(() => this._project()?.sprintProgress ?? null);

  chartOptions: ChartConfiguration<'doughnut'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '65%',
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
  };

  chartData = computed<ChartConfiguration<'doughnut'>['data']>(() => {
    const sp = this.sprint();
    const done = sp?.completedSP ?? 0;
    const remaining = Math.max(0, (sp?.totalSP ?? 0) - done);
    return {
      labels: ['done', 'remaining'],
      datasets: [
        {
          data: [done, remaining],
          backgroundColor: ['#2563eb', '#e2e8f0'],
          borderWidth: 0,
        },
      ],
    };
  });

  relativeLastAccessed(): string {
    const ts = this._project()?.lastAccessedAt;
    if (!ts) return '';
    const date = new Date(ts);
    if (!Number.isFinite(date.getTime())) return '';
    const diffMs = Date.now() - date.getTime();
    const minutes = Math.floor(diffMs / 60_000);
    if (minutes < 1) return this.i18n.t('freshness_relative_just_now');
    if (minutes < 60) return this.i18n.t('freshness_relative_minutes_ago', { n: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return this.i18n.t('freshness_relative_hours_ago', { n: hours });
    return date.toLocaleDateString('zh-Hant-TW');
  }

  emitOpen(): void {
    const p = this._project();
    if (p) this.open.emit(p.key);
  }

  onKeyboardActivate(event: Event): void {
    event.preventDefault();
    this.emitOpen();
  }
}
