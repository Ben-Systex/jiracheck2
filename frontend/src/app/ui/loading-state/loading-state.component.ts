import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { I18nService } from '../../core/i18n/i18n.service';

@Component({
  selector: 'app-loading-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      role="status"
      aria-live="polite"
      class="flex flex-col items-center justify-center py-12 text-slate-500"
    >
      <span class="inline-block h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-r-transparent" aria-hidden="true"></span>
      <p class="mt-3 text-sm">{{ i18n.t('common_loading') }}</p>
    </div>
  `,
})
export class LoadingStateComponent {
  protected readonly i18n = inject(I18nService);
}
