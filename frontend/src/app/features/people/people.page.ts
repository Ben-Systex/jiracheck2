// T066 + T069 + T070 + T071：US3 人員工作狀況頁
// - 三區塊：搜尋下拉、issue list、stats card
// - issue list / stats card 上方各嵌入 <freshness-bar>
// - 時區處理：起始/結束日 picker 使用 yyyy-MM-dd（瀏覽器本地）；backend 收 ISO date
// - 每列「跳到專案」連結（路由 /projects/:key）
// - 空集合提示「擴大到三個月」按鈕（acceptance #4）
// - 鍵盤友善：button + 表單 label

import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { I18nService } from '../../core/i18n/i18n.service';
import { FreshnessBarComponent, type DataFreshness } from '../../ui/freshness-bar/freshness-bar.component';
import { LoadingStateComponent } from '../../ui/loading-state/loading-state.component';
import { EmptyStateComponent } from '../../ui/empty-state/empty-state.component';
import { ErrorStateComponent } from '../../ui/error-state/error-state.component';
import { ButtonComponent } from '../../ui/button/button.component';
import { SearchBoxComponent } from '../dashboard/search-box.component';
import { StatsCardComponent } from './stats-card/stats-card.component';
import {
  PeopleApiService,
  type IssueListResponse,
  type IssueSummary,
  type PersonRef,
  type PersonStatsResponse,
} from './people-api.service';

type IssuesState = 'idle' | 'loading' | 'ready' | 'empty' | 'error';
type StatsState = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

@Component({
  selector: 'app-people-page',
  standalone: true,
  imports: [
    RouterLink,
    FormsModule,
    FreshnessBarComponent,
    LoadingStateComponent,
    EmptyStateComponent,
    ErrorStateComponent,
    ButtonComponent,
    SearchBoxComponent,
    StatsCardComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="space-y-4">
      <header>
        <h1 class="text-2xl font-semibold text-slate-900">{{ i18n.t('people_title') }}</h1>
        <p class="mt-1 text-sm text-slate-600">{{ i18n.t('people_subtitle') }}</p>
      </header>

      <div class="space-y-2">
        <app-search-box (queryChange)="onSearch($event)" />
        @if (peopleResults().length > 0) {
          <ul role="listbox" [attr.aria-label]="i18n.t('people_search_aria')" class="rounded-md border border-slate-200 bg-white max-h-56 overflow-auto">
            @for (p of peopleResults(); track p.accountId) {
              <li>
                <button
                  type="button"
                  class="w-full text-left px-3 py-2 hover:bg-slate-100 focus-visible:outline-none focus-visible:bg-blue-50"
                  [attr.aria-selected]="selected()?.accountId === p.accountId"
                  (click)="selectPerson(p)"
                >
                  <span class="font-medium text-slate-900">{{ p.displayName }}</span>
                  @if (p.email) { <span class="ml-2 text-xs text-slate-500">{{ p.email }}</span> }
                </button>
              </li>
            }
          </ul>
        }
        @if (searchQ() && peopleResults().length === 0 && !peopleLoading()) {
          <p class="text-sm text-slate-500">{{ i18n.t('people_search_no_result') }}</p>
        }
      </div>

      @if (!selected()) {
        <app-empty-state
          [title]="i18n.t('people_select_aria')"
          [description]="i18n.t('people_select_hint')"
        />
      } @else {
        <!-- Issues section -->
        <section class="space-y-2">
          <header class="flex items-baseline justify-between">
            <div>
              <h2 class="text-lg font-semibold text-slate-900">{{ i18n.t('people_issues_heading') }}</h2>
              <p class="text-xs text-slate-500">{{ i18n.t('people_issues_subtitle') }}</p>
            </div>
          </header>
          @if (issuesFreshness(); as f) {
            <app-freshness-bar [freshness]="f" (refresh)="reloadIssues(true)" />
          }
          @if (issuesPartialPermission()) {
            <p class="rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-800" role="status">
              {{ i18n.t('people_partial_permission') }}
            </p>
          }
          @switch (issuesState()) {
            @case ('loading') { <app-loading-state /> }
            @case ('error') {
              <app-error-state [description]="issuesError()" (retry)="reloadIssues(true)" />
            }
            @case ('empty') {
              <app-empty-state
                [title]="i18n.t('people_issues_empty_title')"
                [description]="i18n.t('people_issues_empty_description')"
              />
            }
            @case ('ready') {
              <ul role="list" class="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
                @for (issue of issues(); track issue.key) {
                  <li class="px-3 py-2 hover:bg-slate-50">
                    <div class="flex items-start justify-between gap-3">
                      <div class="min-w-0">
                        <p class="text-sm font-medium text-slate-900 truncate">
                          <span class="text-slate-500">{{ issue.key }}</span>
                          {{ ' ' }}{{ issue.summary }}
                        </p>
                        <p class="mt-0.5 text-xs text-slate-500">
                          {{ issue.status }}
                          @if (issue.dueDate) {
                            <span class="ml-2">到期 {{ issue.dueDate }}</span>
                          } @else {
                            <span class="ml-2 text-slate-400">{{ i18n.t('people_issue_no_due') }}</span>
                          }
                        </p>
                      </div>
                      <a
                        [routerLink]="['/projects', issue.projectKey]"
                        class="shrink-0 rounded-md px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                        [attr.aria-label]="i18n.t('people_issue_jump_project', { project: issue.projectKey })"
                      >{{ issue.projectKey }} →</a>
                    </div>
                  </li>
                }
              </ul>
            }
          }
        </section>

        <!-- Stats section -->
        <section class="space-y-2">
          <header class="flex items-baseline justify-between">
            <h2 class="text-lg font-semibold text-slate-900">{{ i18n.t('people_stats_heading') }}</h2>
          </header>
          <form class="flex flex-wrap items-end gap-3 rounded-md bg-slate-50 p-3" (submit)="onApplyStats($event)">
            <label class="text-xs text-slate-600">
              <span class="block">{{ i18n.t('people_stats_from_label') }}</span>
              <input
                type="date"
                name="from"
                class="mt-0.5 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                [ngModel]="from()"
                (ngModelChange)="from.set($event)"
                required
              />
            </label>
            <label class="text-xs text-slate-600">
              <span class="block">{{ i18n.t('people_stats_to_label') }}</span>
              <input
                type="date"
                name="to"
                class="mt-0.5 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                [ngModel]="to()"
                (ngModelChange)="to.set($event)"
                required
              />
            </label>
            <app-button type="submit" variant="primary" size="sm">{{ i18n.t('people_stats_apply') }}</app-button>
          </form>
          @if (statsFreshness(); as f) {
            <app-freshness-bar [freshness]="f" (refresh)="reloadStats(true)" />
          }
          @switch (statsState()) {
            @case ('loading') { <app-loading-state /> }
            @case ('error') {
              <app-error-state [description]="statsError()" (retry)="reloadStats(true)" />
            }
            @case ('empty') {
              <app-empty-state
                [title]="i18n.t('people_stats_empty_title')"
                [description]="i18n.t('people_stats_empty_description')"
              >
                <app-button variant="secondary" size="sm" (click)="expandTo3Months()">
                  {{ i18n.t('people_stats_expand_range') }}
                </app-button>
              </app-empty-state>
            }
            @case ('ready') {
              <app-stats-card [statsInput]="statsData()" />
            }
            @case ('idle') {
              <p class="text-sm text-slate-500">{{ i18n.t('people_stats_empty_description') }}</p>
            }
          }
        </section>
      }
    </section>
  `,
})
export class PeoplePageComponent {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(PeopleApiService);

  // search
  protected readonly searchQ = signal('');
  protected readonly peopleResults = signal<PersonRef[]>([]);
  protected readonly peopleLoading = signal(false);
  protected readonly selected = signal<PersonRef | null>(null);

  // issues
  protected readonly issuesState = signal<IssuesState>('idle');
  protected readonly issues = signal<IssueSummary[]>([]);
  protected readonly issuesFreshness = signal<DataFreshness | undefined>(undefined);
  protected readonly issuesPartialPermission = signal(false);
  protected readonly issuesError = signal<string | undefined>(undefined);

  // stats
  protected readonly from = signal<string>(this.defaultFrom());
  protected readonly to = signal<string>(this.defaultTo());
  protected readonly statsState = signal<StatsState>('idle');
  protected readonly statsData = signal<PersonStatsResponse | null>(null);
  protected readonly statsFreshness = signal<DataFreshness | undefined>(undefined);
  protected readonly statsError = signal<string | undefined>(undefined);

  async onSearch(q: string): Promise<void> {
    this.searchQ.set(q);
    if (q.length === 0) {
      this.peopleResults.set([]);
      return;
    }
    this.peopleLoading.set(true);
    try {
      const res = await firstValueFrom(this.api.searchPeople(q));
      this.peopleResults.set(res.items);
    } catch {
      this.peopleResults.set([]);
    } finally {
      this.peopleLoading.set(false);
    }
  }

  selectPerson(p: PersonRef): void {
    this.selected.set(p);
    this.peopleResults.set([]);
    void this.reloadIssues();
  }

  async reloadIssues(refresh = false): Promise<void> {
    const p = this.selected();
    if (!p) return;
    this.issuesState.set('loading');
    this.issuesError.set(undefined);
    try {
      const res: IssueListResponse = await firstValueFrom(
        this.api.listIssues(p.accountId, { status: 'open', refresh }),
      );
      this.issues.set(res.items);
      this.issuesFreshness.set(res.dataFreshness);
      this.issuesPartialPermission.set(res.partialPermission);
      this.issuesState.set(res.items.length === 0 ? 'empty' : 'ready');
    } catch (err) {
      this.issuesError.set(extractMessage(err));
      this.issuesState.set('error');
    }
  }

  onApplyStats(event: Event): void {
    event.preventDefault();
    void this.reloadStats();
  }

  async reloadStats(refresh = false): Promise<void> {
    const p = this.selected();
    if (!p) return;
    this.statsState.set('loading');
    this.statsError.set(undefined);
    try {
      const res = await firstValueFrom(this.api.getStats(p.accountId, this.from(), this.to(), refresh));
      this.statsData.set(res);
      this.statsFreshness.set(res.dataFreshness);
      this.statsState.set(res.items.length === 0 ? 'empty' : 'ready');
    } catch (err) {
      this.statsError.set(extractMessage(err));
      this.statsState.set('error');
    }
  }

  expandTo3Months(): void {
    const to = new Date();
    const from = new Date();
    from.setMonth(from.getMonth() - 3);
    this.from.set(toYmd(from));
    this.to.set(toYmd(to));
    void this.reloadStats();
  }

  private defaultFrom(): string {
    const d = new Date();
    d.setDate(1);
    return toYmd(d);
  }

  private defaultTo(): string {
    return toYmd(new Date());
  }
}

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function extractMessage(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'title' in err) {
    return String((err as { title: unknown }).title);
  }
  return undefined;
}
