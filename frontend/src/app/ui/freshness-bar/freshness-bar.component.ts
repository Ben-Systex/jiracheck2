import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { I18nService } from '../../core/i18n/i18n.service';

export interface DataFreshness {
  fetchedAt: string;
  source: 'live' | 'cache';
  cacheTtlSeconds?: number;
}

@Component({
  selector: 'app-freshness-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-1.5 text-xs text-slate-600"
      role="status"
    >
      <div class="flex items-center gap-2">
        <span
          class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
          [class]="sourceBadgeClass()"
          [attr.aria-label]="sourceLabel()"
        >{{ sourceLabel() }}</span>
        <time [attr.datetime]="freshness?.fetchedAt">{{ relative() }}</time>
      </div>
      <button
        type="button"
        class="rounded-md px-2 py-1 text-blue-600 hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        [attr.aria-label]="i18n.t('freshness_aria_refresh')"
        (click)="refresh.emit()"
      >
        {{ i18n.t('common_refresh') }}
      </button>
    </div>
  `,
})
export class FreshnessBarComponent {
  protected readonly i18n = inject(I18nService);

  @Input() freshness: DataFreshness | undefined;
  @Output() refresh = new EventEmitter<void>();

  sourceLabel(): string {
    return this.freshness?.source === 'cache'
      ? this.i18n.t('freshness_cache')
      : this.i18n.t('freshness_live');
  }

  sourceBadgeClass(): string {
    return this.freshness?.source === 'cache'
      ? 'bg-amber-100 text-amber-800'
      : 'bg-emerald-100 text-emerald-800';
  }

  relative(): string {
    if (!this.freshness) return '';
    const fetchedAt = new Date(this.freshness.fetchedAt).getTime();
    if (!Number.isFinite(fetchedAt)) return '';
    const diffMs = Date.now() - fetchedAt;
    const minutes = Math.floor(diffMs / 60_000);
    if (minutes < 1) return this.i18n.t('freshness_relative_just_now');
    if (minutes < 60) return this.i18n.t('freshness_relative_minutes_ago', { n: minutes });
    const hours = Math.floor(minutes / 60);
    return this.i18n.t('freshness_relative_hours_ago', { n: hours });
  }
}
