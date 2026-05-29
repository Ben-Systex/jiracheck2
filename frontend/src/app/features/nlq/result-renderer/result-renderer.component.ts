// T056：8 個 intent 的多型 renderer
// - list_issues：清單（含跳到專案連結）
// - count_issues：number card
// - sum_*, avg_*：number card
// - top_n_assignees：人員 ranking 表
// - group_count：分組計數表

import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18nService } from '../../../core/i18n/i18n.service';
import type { NlqIntent, NlqResponse } from '../nlq-api.service';

interface ListItem {
  key: string;
  summary: string;
  status: string;
  projectKey: string;
  assignee: { accountId: string; displayName: string } | null;
}

interface TopAssigneeRow {
  person: { accountId: string; displayName: string };
  count: number;
}

interface GroupCountRow {
  key: string;
  count: number;
}

@Component({
  selector: 'app-nlq-result-renderer',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (intent) {
      @case ('list_issues') {
        @if (items().length === 0) {
          <p class="text-sm text-slate-500">{{ i18n.t('nlq_list_empty') }}</p>
        } @else {
          <ul class="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
            @for (it of items(); track it.key) {
              <li class="flex items-start justify-between gap-3 px-3 py-2">
                <div class="min-w-0">
                  <p class="text-sm font-medium text-slate-900 truncate">
                    <span class="text-slate-500">{{ it.key }}</span>
                    {{ ' ' }}{{ it.summary }}
                  </p>
                  <p class="mt-0.5 text-xs text-slate-500">
                    {{ it.status }}
                    @if (it.assignee) {<span class="ml-2">— {{ it.assignee.displayName }}</span>}
                  </p>
                </div>
                <a
                  [routerLink]="['/projects', it.projectKey]"
                  class="shrink-0 rounded-md px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >{{ it.projectKey }} →</a>
              </li>
            }
          </ul>
        }
      }
      @case ('count_issues') {
        <div class="rounded-md border border-slate-200 bg-white p-4">
          <p class="text-xs text-slate-500">{{ i18n.t('nlq_count_label') }}</p>
          <p class="mt-1 text-2xl font-semibold text-slate-900">{{ count() }}</p>
        </div>
      }
      @case ('sum_story_points') {
        <div class="rounded-md border border-slate-200 bg-white p-4">
          <p class="text-xs text-slate-500">{{ i18n.t('nlq_sum_label') }}</p>
          <p class="mt-1 text-2xl font-semibold text-slate-900">{{ sum() }}</p>
        </div>
      }
      @case ('sum_actual_story_points') {
        <div class="rounded-md border border-slate-200 bg-white p-4">
          <p class="text-xs text-slate-500">{{ i18n.t('nlq_sum_label') }}</p>
          <p class="mt-1 text-2xl font-semibold text-slate-900">{{ sum() }}</p>
        </div>
      }
      @case ('avg_story_points') {
        <div class="rounded-md border border-slate-200 bg-white p-4">
          <p class="text-xs text-slate-500">{{ i18n.t('nlq_avg_label') }}</p>
          <p class="mt-1 text-2xl font-semibold text-slate-900">{{ avg() }}</p>
        </div>
      }
      @case ('avg_actual_story_points') {
        <div class="rounded-md border border-slate-200 bg-white p-4">
          <p class="text-xs text-slate-500">{{ i18n.t('nlq_avg_label') }}</p>
          <p class="mt-1 text-2xl font-semibold text-slate-900">{{ avg() }}</p>
        </div>
      }
      @case ('top_n_assignees') {
        <section>
          <h3 class="sr-only">{{ i18n.t('nlq_top_n_heading') }}</h3>
          <ol class="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
            @for (row of topItems(); track row.person.accountId; let idx = $index) {
              <li class="flex items-center justify-between px-3 py-2 text-sm">
                <span class="font-medium text-slate-900">
                  <span class="mr-2 text-slate-500">#{{ idx + 1 }}</span>{{ row.person.displayName }}
                </span>
                <span class="text-slate-600">{{ row.count }}</span>
              </li>
            }
          </ol>
        </section>
      }
      @case ('group_count') {
        <section>
          <h3 class="sr-only">{{ i18n.t('nlq_group_count_heading') }}</h3>
          <ul class="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
            @for (row of groupItems(); track row.key) {
              <li class="flex items-center justify-between px-3 py-2 text-sm">
                <span class="font-medium text-slate-900">{{ row.key }}</span>
                <span class="text-slate-600">{{ row.count }}</span>
              </li>
            }
          </ul>
        </section>
      }
    }

  `,
})
export class NlqResultRendererComponent {
  protected readonly i18n = inject(I18nService);

  @Input({ required: true }) intent!: NlqIntent;
  @Input({ required: true }) response!: NlqResponse;

  items(): ListItem[] {
    return (this.response.results?.['items'] as ListItem[] | undefined) ?? [];
  }
  count(): number {
    return Number(this.response.results?.['count'] ?? 0);
  }
  sum(): number {
    return Number(this.response.results?.['sum'] ?? 0);
  }
  avg(): number | string {
    const v = this.response.results?.['avg'];
    return v === null || v === undefined ? '—' : Number(v);
  }
  topItems(): TopAssigneeRow[] {
    return (this.response.results?.['items'] as TopAssigneeRow[] | undefined) ?? [];
  }
  groupItems(): GroupCountRow[] {
    return (this.response.results?.['items'] as GroupCountRow[] | undefined) ?? [];
  }
}
