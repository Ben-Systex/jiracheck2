import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { I18nService } from '../core/i18n/i18n.service';
import type { MessageKey } from '../core/i18n/messages';

/** Phase 2 暫用：每個 feature 路由的佔位畫面，待 Phase 3+ 替換 */
@Component({
  selector: 'app-placeholder',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
      <h2 class="text-xl font-semibold text-slate-800">{{ title() }}</h2>
      <p class="mt-2 text-sm text-slate-500">
        {{ i18n.t('placeholder_pending', { phase: phase() }) }}
      </p>
    </section>
  `,
})
export class PlaceholderComponent {
  private readonly route = inject(ActivatedRoute);
  protected readonly i18n = inject(I18nService);

  title(): string {
    const key = (this.route.snapshot.data['titleKey'] as MessageKey | undefined) ?? 'common_loading';
    return this.i18n.t(key);
  }

  phase(): number {
    const key = this.route.snapshot.data['titleKey'] as string | undefined;
    if (key === 'nav_dashboard') return 3;
    if (key === 'nav_nlq') return 4;
    if (key === 'nav_people') return 5;
    if (key === 'nav_bulk_update') return 6;
    return 0;
  }
}
