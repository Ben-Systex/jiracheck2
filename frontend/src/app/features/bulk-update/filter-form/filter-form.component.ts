// T085：US4 篩選表單 + 目標欄位設定
// - 欄位限定 Status / Assignee / Sprint / Issue Type / Label / Due Date（FR-040）
// - 目標欄位限定白名單（FR-047）
// - 對外 emit { projectKey, filter, targetField, targetValue }

import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Output,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { I18nService } from '../../../core/i18n/i18n.service';
import { ButtonComponent } from '../../../ui/button/button.component';
import type {
  BulkFilter,
  BulkPreviewRequest,
  BulkTargetField,
} from '../bulk-api.service';

const TARGET_FIELDS: readonly BulkTargetField[] = [
  'assignee',
  'due_date',
  'label',
  'priority',
  'sprint',
];

@Component({
  selector: 'app-bulk-filter-form',
  standalone: true,
  imports: [FormsModule, ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="space-y-3" (submit)="onSubmit($event)">
      <label class="block text-sm">
        <span class="text-slate-700">{{ i18n.t('bulk_project_label') }}</span>
        <input
          type="text"
          class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          [(ngModel)]="projectKey"
          name="projectKey"
          required
          [placeholder]="i18n.t('bulk_project_placeholder')"
        />
      </label>

      <fieldset class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label class="block text-sm">
          <span class="text-slate-700">{{ i18n.t('bulk_filter_status') }}</span>
          <input type="text" class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            [(ngModel)]="statusesRaw" name="statuses" placeholder="To Do, In Progress" />
        </label>
        <label class="block text-sm">
          <span class="text-slate-700">{{ i18n.t('bulk_filter_assignee') }}</span>
          <input type="text" class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            [(ngModel)]="assigneeRaw" name="assignee" />
        </label>
        <label class="block text-sm">
          <span class="text-slate-700">{{ i18n.t('bulk_filter_sprint') }}</span>
          <input type="text" class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            [(ngModel)]="sprintRaw" name="sprint" />
        </label>
        <label class="block text-sm">
          <span class="text-slate-700">{{ i18n.t('bulk_filter_label') }}</span>
          <input type="text" class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            [(ngModel)]="labelsRaw" name="labels" />
        </label>
        <label class="block text-sm">
          <span class="text-slate-700">{{ i18n.t('bulk_filter_issue_type') }}</span>
          <input type="text" class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            [(ngModel)]="issueTypesRaw" name="issueTypes" />
        </label>
        <label class="block text-sm">
          <span class="text-slate-700">{{ i18n.t('bulk_filter_due_from') }}</span>
          <input type="date" class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            [(ngModel)]="dueFrom" name="dueFrom" />
        </label>
        <label class="block text-sm">
          <span class="text-slate-700">{{ i18n.t('bulk_filter_due_to') }}</span>
          <input type="date" class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            [(ngModel)]="dueTo" name="dueTo" />
        </label>
      </fieldset>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label class="block text-sm">
          <span class="text-slate-700">{{ i18n.t('bulk_target_field_label') }}</span>
          <select class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white"
            [(ngModel)]="targetField" name="targetField" required>
            @for (f of targetFields; track f) {
              <option [value]="f">{{ targetFieldLabel(f) }}</option>
            }
          </select>
        </label>
        <label class="block text-sm">
          <span class="text-slate-700">{{ i18n.t('bulk_target_value_label') }}</span>
          <input type="text" class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            [(ngModel)]="targetValueRaw" name="targetValue" required />
        </label>
      </div>

      <div>
        <app-button type="submit" variant="primary">{{ i18n.t('bulk_preview_button') }}</app-button>
      </div>
    </form>
  `,
})
export class BulkFilterFormComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly targetFields = TARGET_FIELDS;

  protected projectKey = '';
  protected statusesRaw = '';
  protected assigneeRaw = '';
  protected sprintRaw = '';
  protected labelsRaw = '';
  protected issueTypesRaw = '';
  protected dueFrom = '';
  protected dueTo = '';
  protected targetField: BulkTargetField = 'assignee';
  protected targetValueRaw = '';

  @Output() readonly submitted = new EventEmitter<BulkPreviewRequest>();

  protected readonly _signal = signal(0); // 觸發 detectChanges

  targetFieldLabel(f: BulkTargetField): string {
    switch (f) {
      case 'assignee':
        return this.i18n.t('bulk_target_field_assignee');
      case 'due_date':
        return this.i18n.t('bulk_target_field_due_date');
      case 'label':
        return this.i18n.t('bulk_target_field_label_field');
      case 'priority':
        return this.i18n.t('bulk_target_field_priority');
      case 'sprint':
        return this.i18n.t('bulk_target_field_sprint');
    }
  }

  onSubmit(event: Event): void {
    event.preventDefault();
    if (!this.projectKey) return;
    this.submitted.emit({
      projectKey: this.projectKey.trim(),
      filter: this.buildFilter(),
      targetField: this.targetField,
      targetValue: this.coerceTargetValue(this.targetValueRaw.trim()),
    });
  }

  private buildFilter(): BulkFilter {
    const filter: BulkFilter = {};
    setIfRaw(filter, 'statuses', this.statusesRaw);
    setIfRaw(filter, 'assigneeAccountIds', this.assigneeRaw);
    setIfRaw(filter, 'sprintNames', this.sprintRaw);
    setIfRaw(filter, 'labels', this.labelsRaw);
    setIfRaw(filter, 'issueTypes', this.issueTypesRaw);
    if (this.dueFrom || this.dueTo) {
      filter.dueDateRange = {
        ...(this.dueFrom ? { from: this.dueFrom } : {}),
        ...(this.dueTo ? { to: this.dueTo } : {}),
      };
    }
    return filter;
  }

  private coerceTargetValue(raw: string): unknown {
    if (this.targetField === 'label') return splitCsv(raw);
    return raw;
  }
}

function splitCsv(s: string): string[] {
  return s
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function setIfRaw<K extends keyof BulkFilter>(filter: BulkFilter, key: K, raw: string): void {
  if (!raw) return;
  // 限縮在「值為 string[] 的欄位」；dueDateRange 由 caller 自行處理
  (filter as Record<string, string[]>)[key as string] = splitCsv(raw);
}
