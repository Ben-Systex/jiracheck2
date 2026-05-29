// T086：preview table — currentValue / proposedValue / editableByUser badge + 200 上限警示

import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  inject,
} from '@angular/core';
import { I18nService } from '../../../core/i18n/i18n.service';
import { ButtonComponent } from '../../../ui/button/button.component';
import type { BulkPreviewItem } from '../bulk-api.service';

@Component({
  selector: 'app-bulk-preview-table',
  standalone: true,
  imports: [ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="space-y-2">
      <div class="flex items-baseline justify-between gap-3">
        <p class="text-sm font-medium text-slate-800">
          {{ i18n.t('bulk_preview_total', { n: totalCount }) }}
        </p>
        @if (previewAt) {
          <p class="text-xs text-slate-500">
            {{ i18n.t('bulk_preview_at', { when: previewAt }) }}
            <button
              type="button"
              class="ml-2 text-blue-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              (click)="repreview.emit()"
            >{{ i18n.t('bulk_preview_repreview') }}</button>
          </p>
        }
      </div>

      @if (totalCount >= 200) {
        <p class="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800" role="status">
          {{ i18n.t('bulk_preview_over_limit', { n: totalCount }) }}
        </p>
      }

      <div class="overflow-x-auto rounded-md border border-slate-200">
        <table class="min-w-full divide-y divide-slate-200 text-sm">
          <thead class="bg-slate-50">
            <tr>
              <th scope="col" class="px-3 py-2 text-left text-xs font-semibold text-slate-600">{{ i18n.t('bulk_preview_table_key') }}</th>
              <th scope="col" class="px-3 py-2 text-left text-xs font-semibold text-slate-600">{{ i18n.t('bulk_preview_table_current') }}</th>
              <th scope="col" class="px-3 py-2 text-left text-xs font-semibold text-slate-600">{{ i18n.t('bulk_preview_table_proposed') }}</th>
              <th scope="col" class="px-3 py-2 text-left text-xs font-semibold text-slate-600">{{ i18n.t('bulk_preview_table_editable') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100 bg-white">
            @for (item of items; track item.issueKey) {
              <tr>
                <td class="px-3 py-2 align-top">
                  <p class="font-medium text-slate-900">{{ item.issueKey }}</p>
                  <p class="text-xs text-slate-500">{{ item.summary }}</p>
                </td>
                <td class="px-3 py-2 align-top text-slate-700">{{ display(item.currentValue) }}</td>
                <td class="px-3 py-2 align-top text-slate-700">{{ display(item.proposedValue) }}</td>
                <td class="px-3 py-2 align-top">
                  @if (item.editableByUser) {
                    <span class="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
                      {{ i18n.t('bulk_preview_editable_yes') }}
                    </span>
                  } @else {
                    <span class="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800">
                      {{ i18n.t('bulk_preview_editable_no') }}
                    </span>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <div class="flex justify-end gap-2">
        <app-button variant="secondary" (click)="back.emit()">{{ i18n.t('bulk_back') }}</app-button>
        <app-button
          variant="primary"
          [disabled]="!canApply()"
          (click)="apply.emit()"
        >{{ i18n.t('bulk_apply_button') }}</app-button>
      </div>
    </section>
  `,
})
export class BulkPreviewTableComponent {
  protected readonly i18n = inject(I18nService);

  @Input({ required: true }) items: BulkPreviewItem[] = [];
  @Input({ required: true }) totalCount = 0;
  @Input() previewAt: string | null = null;
  @Output() readonly repreview = new EventEmitter<void>();
  @Output() readonly back = new EventEmitter<void>();
  @Output() readonly apply = new EventEmitter<void>();

  canApply(): boolean {
    return this.totalCount > 0 && this.totalCount <= 200 && this.items.some((i) => i.editableByUser);
  }

  display(v: unknown): string {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) return v.map((x) => this.display(x)).join(', ');
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>;
      return (o['displayName'] as string) ?? (o['name'] as string) ?? JSON.stringify(o);
    }
    return JSON.stringify(v);
  }
}
