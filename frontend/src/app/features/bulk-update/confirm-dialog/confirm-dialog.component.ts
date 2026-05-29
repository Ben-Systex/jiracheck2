// T087：確認對話框
// - 使用者必須輸入「確認更新 N 筆」（^確認更新\s*(\d+)\s*筆$）
// - 即時驗證：格式錯誤或 N != totalCount 即顯示提示，禁用「套用」鈕
// - emit 包含 {confirmText, confirmCount} 給上層送 /bulk/apply

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
import { FormsModule } from '@angular/forms';
import { I18nService } from '../../../core/i18n/i18n.service';
import { ButtonComponent } from '../../../ui/button/button.component';

const PATTERN = /^確認更新\s*(\d+)\s*筆$/;

@Component({
  selector: 'app-bulk-confirm-dialog',
  standalone: true,
  imports: [FormsModule, ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      role="dialog"
      [attr.aria-label]="i18n.t('bulk_confirm_dialog_title')"
      class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm space-y-3"
    >
      <header>
        <h3 class="text-base font-semibold text-slate-900">{{ i18n.t('bulk_confirm_dialog_title') }}</h3>
        <p class="mt-1 text-sm text-slate-600">{{ i18n.t('bulk_confirm_dialog_hint', { n: totalCount }) }}</p>
      </header>
      <label class="block">
        <span class="text-sm text-slate-700">{{ i18n.t('bulk_confirm_input_label') }}</span>
        <input
          type="text"
          class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
          [placeholder]="i18n.t('bulk_confirm_input_placeholder')"
          [ngModel]="text()"
          (ngModelChange)="text.set($event)"
          name="confirmText"
          aria-describedby="bulk-confirm-error"
        />
      </label>
      @if (errorMessage(); as msg) {
        <p id="bulk-confirm-error" class="text-xs text-red-600" role="alert">{{ msg }}</p>
      }
      <div class="flex justify-end gap-2">
        <app-button variant="secondary" (click)="cancelled.emit()">{{ i18n.t('common_cancel') }}</app-button>
        <app-button
          variant="primary"
          [disabled]="!canConfirm()"
          (click)="onConfirm()"
        >{{ i18n.t('common_confirm') }}</app-button>
      </div>
    </section>
  `,
})
export class BulkConfirmDialogComponent {
  protected readonly i18n = inject(I18nService);
  @Input({ required: true }) totalCount = 0;

  protected readonly text = signal('');

  protected readonly parsedN = computed<number | null>(() => {
    const m = PATTERN.exec(this.text().trim());
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isInteger(n) && n >= 0 ? n : null;
  });

  protected readonly errorMessage = computed<string | undefined>(() => {
    const t = this.text().trim();
    if (t.length === 0) return undefined;
    if (this.parsedN() === null) return this.i18n.t('bulk_confirm_invalid_format');
    if (this.parsedN() !== this.totalCount) {
      return this.i18n.t('bulk_confirm_count_mismatch', { n: this.totalCount });
    }
    return undefined;
  });

  @Output() readonly confirmed = new EventEmitter<{ confirmText: string; confirmCount: number }>();
  @Output() readonly cancelled = new EventEmitter<void>();

  canConfirm(): boolean {
    return this.parsedN() === this.totalCount && this.totalCount > 0;
  }

  onConfirm(): void {
    if (!this.canConfirm()) return;
    this.confirmed.emit({
      confirmText: this.text().trim(),
      confirmCount: this.totalCount,
    });
  }
}
