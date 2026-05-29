// T036 + T040 + T041：US1 dashboard 主頁
// - 兩種狀態：搜尋字串為空時顯示「最近 5 個」；否則顯示「搜尋結果」
// - 三態 wrapper：loading / empty / error（憲法 III）
// - <freshness-bar> 嵌頂；refresh 觸發重打 API 並帶 refresh=true（FR-003）
// - 鍵盤導覽 + ARIA label（憲法 III + WCAG 2.1 AA）：search-box 與 project-card 已內建

import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { I18nService } from '../../core/i18n/i18n.service';
import {
  ProjectsApiService,
  type ProjectCard,
} from './projects-api.service';
import type { DataFreshness } from '../../ui/freshness-bar/freshness-bar.component';
import { FreshnessBarComponent } from '../../ui/freshness-bar/freshness-bar.component';
import { LoadingStateComponent } from '../../ui/loading-state/loading-state.component';
import { EmptyStateComponent } from '../../ui/empty-state/empty-state.component';
import { ErrorStateComponent } from '../../ui/error-state/error-state.component';
import { ProjectCardComponent } from '../../ui/project-card/project-card.component';
import { SearchBoxComponent } from './search-box.component';

type ViewState = 'loading' | 'ready' | 'error' | 'empty';

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [
    FreshnessBarComponent,
    LoadingStateComponent,
    EmptyStateComponent,
    ErrorStateComponent,
    ProjectCardComponent,
    SearchBoxComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="space-y-4">
      <header>
        <h1 class="text-2xl font-semibold text-slate-900">{{ i18n.t('dashboard_title') }}</h1>
        <p class="mt-1 text-sm text-slate-600">{{ i18n.t('dashboard_subtitle') }}</p>
      </header>

      <app-search-box (queryChange)="onQueryChange($event)" />

      @if (freshness(); as f) {
        <app-freshness-bar [freshness]="f" (refresh)="refresh()" />
      }

      @switch (state()) {
        @case ('loading') { <app-loading-state /> }
        @case ('error') {
          <app-error-state
            [description]="errorMessage()"
            (retry)="refresh()"
          />
        }
        @case ('empty') {
          @if (query()) {
            <app-empty-state
              [title]="i18n.t('dashboard_search_no_result_title')"
              [description]="i18n.t('dashboard_search_no_result_description')"
            />
          } @else {
            <app-empty-state
              [title]="i18n.t('dashboard_no_recent_title')"
              [description]="i18n.t('dashboard_no_recent_description')"
            />
          }
        }
        @case ('ready') {
          <section>
            <h2 class="sr-only">
              {{ query()
                ? i18n.t('dashboard_search_results_heading')
                : i18n.t('dashboard_recent_heading') }}
            </h2>
            <ul role="list" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              @for (item of items(); track item.key) {
                <li>
                  <app-project-card
                    [projectInput]="item"
                    (open)="openProject($event)"
                  />
                </li>
              }
            </ul>
          </section>
        }
      }
    </section>
  `,
})
export class DashboardPageComponent {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(ProjectsApiService);
  private readonly router = inject(Router);

  protected readonly query = signal('');
  protected readonly state = signal<ViewState>('loading');
  protected readonly items = signal<ProjectCard[]>([]);
  protected readonly freshness = signal<DataFreshness | undefined>(undefined);
  protected readonly errorMessage = signal<string | undefined>(undefined);

  constructor() {
    void this.loadRecent();
  }

  onQueryChange(q: string): void {
    this.query.set(q);
    if (q.length === 0) {
      void this.loadRecent();
      return;
    }
    void this.loadSearch(q);
  }

  refresh(): void {
    const q = this.query();
    if (q.length > 0) void this.loadSearch(q, true);
    else void this.loadRecent(true);
  }

  async openProject(key: string): Promise<void> {
    // 雙路徑：先呼叫 /projects/{key} 觸發 backend 端 recent-access upsert，
    // 接著導航；即使 GET 失敗，仍嘗試導航讓 user 看到該頁的錯誤 state（由該頁處理）
    try {
      await firstValueFrom(this.api.getOne(key));
    } catch {
      /* 吞掉：詳細頁會處理錯誤 */
    }
    await this.router.navigate(['/projects', key]);
  }

  private async loadRecent(refresh = false): Promise<void> {
    this.state.set('loading');
    this.errorMessage.set(undefined);
    try {
      const res = await firstValueFrom(this.api.recent({ refresh }));
      this.items.set(res.items);
      this.freshness.set(res.dataFreshness);
      this.state.set(res.items.length === 0 ? 'empty' : 'ready');
    } catch (err) {
      this.handleError(err);
    }
  }

  private async loadSearch(q: string, refresh = false): Promise<void> {
    this.state.set('loading');
    this.errorMessage.set(undefined);
    try {
      const res = await firstValueFrom(this.api.search(q, { refresh }));
      this.items.set(res.items);
      this.freshness.set(res.dataFreshness);
      this.state.set(res.items.length === 0 ? 'empty' : 'ready');
    } catch (err) {
      this.handleError(err);
    }
  }

  private handleError(err: unknown): void {
    const message =
      typeof err === 'object' && err !== null && 'title' in err
        ? String((err as { title: unknown }).title)
        : undefined;
    this.errorMessage.set(message);
    this.state.set('error');
  }
}
