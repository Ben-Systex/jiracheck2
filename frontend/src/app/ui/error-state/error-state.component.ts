import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { ButtonComponent } from '../button/button.component';
import { I18nService } from '../../core/i18n/i18n.service';

@Component({
  selector: 'app-error-state',
  standalone: true,
  imports: [ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      role="alert"
      class="flex flex-col items-center justify-center py-12 text-center text-slate-700"
    >
      <p class="text-base font-semibold text-red-600">{{ title || i18n.t('error_generic_title') }}</p>
      <p class="mt-1 max-w-md text-sm text-slate-600">
        {{ description || i18n.t('error_generic_description') }}
      </p>
      @if (showRetry) {
        <div class="mt-4">
          <app-button variant="secondary" (click)="retry.emit()">{{ i18n.t('common_retry') }}</app-button>
        </div>
      }
    </div>
  `,
})
export class ErrorStateComponent {
  protected readonly i18n = inject(I18nService);
  @Input() title?: string;
  @Input() description?: string;
  @Input() showRetry = true;
  @Output() retry = new EventEmitter<void>();
}
