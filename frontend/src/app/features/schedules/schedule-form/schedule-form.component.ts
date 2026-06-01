// T028：US1 排程表單元件
// - frequencyType radio + 對應子表單（time picker / dow / dom / cron）
// - 所有時間欄位下方顯示固定字樣「依伺服器時區 Asia/Taipei」（patch P5 / FR-008）
// - output `submitted` event 傳 ScheduleConfigInput

import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { I18nService } from '../../../core/i18n/i18n.service';
import { ButtonComponent } from '../../../ui/button/button.component';
import type {
  FrequencyType,
  ScheduleConfig,
  ScheduleConfigInput,
  ServiceId,
} from '../schedules-api.service';

const SERVICE_IDS: readonly ServiceId[] = ['CHKPROJ', 'CHKISSUE'];
const FREQUENCY_TYPES: readonly FrequencyType[] = ['daily', 'weekly', 'monthly', 'cron'];

@Component({
  selector: 'app-schedule-form',
  standalone: true,
  imports: [FormsModule, ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="space-y-3" (submit)="onSubmit($event)">
      <label class="block text-sm">
        <span class="text-slate-700">{{ i18n.t('schedules_form_service') }}</span>
        <select
          class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          [(ngModel)]="serviceId"
          name="serviceId"
          required
        >
          @for (sid of serviceIds; track sid) {
            <option [value]="sid">{{ sid }}</option>
          }
        </select>
      </label>

      <fieldset>
        <legend class="text-sm text-slate-700">
          {{ i18n.t('schedules_form_frequency_type') }}
        </legend>
        <div class="mt-1 flex gap-3 flex-wrap">
          @for (ft of frequencyTypes; track ft) {
            <label class="inline-flex items-center gap-1 text-sm">
              <input type="radio" name="frequencyType" [value]="ft" [(ngModel)]="frequencyType" />
              <span>{{ frequencyLabel(ft) }}</span>
            </label>
          }
        </div>
      </fieldset>

      @if (frequencyType === 'daily') {
        <label class="block text-sm">
          <span class="text-slate-700">{{ i18n.t('schedules_form_time') }}</span>
          <input
            type="time"
            class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            [(ngModel)]="dailyTime"
            name="dailyTime"
            required
          />
          <span class="text-xs text-slate-500 block mt-1">
            {{ i18n.t('schedule_form_tz_hint') }}
          </span>
        </label>
      }

      @if (frequencyType === 'weekly') {
        <div class="grid grid-cols-2 gap-3">
          <label class="block text-sm">
            <span class="text-slate-700">{{ i18n.t('schedules_form_time') }}</span>
            <input
              type="time"
              class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              [(ngModel)]="weeklyTime"
              name="weeklyTime"
              required
            />
          </label>
          <label class="block text-sm">
            <span class="text-slate-700">{{ i18n.t('schedules_form_dow') }}</span>
            <input
              type="number"
              min="1"
              max="7"
              class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              [(ngModel)]="weeklyDow"
              name="weeklyDow"
              required
            />
          </label>
          <span class="col-span-2 text-xs text-slate-500">
            {{ i18n.t('schedule_form_tz_hint') }}
          </span>
        </div>
      }

      @if (frequencyType === 'monthly') {
        <div class="grid grid-cols-2 gap-3">
          <label class="block text-sm">
            <span class="text-slate-700">{{ i18n.t('schedules_form_time') }}</span>
            <input
              type="time"
              class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              [(ngModel)]="monthlyTime"
              name="monthlyTime"
              required
            />
          </label>
          <label class="block text-sm">
            <span class="text-slate-700">{{ i18n.t('schedules_form_dom') }}</span>
            <input
              type="number"
              min="1"
              max="28"
              class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              [(ngModel)]="monthlyDom"
              name="monthlyDom"
              required
            />
          </label>
          <span class="col-span-2 text-xs text-slate-500">
            {{ i18n.t('schedule_form_tz_hint') }}
          </span>
        </div>
      }

      @if (frequencyType === 'cron') {
        <label class="block text-sm">
          <span class="text-slate-700">{{ i18n.t('schedules_form_cron') }}</span>
          <input
            type="text"
            class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
            [(ngModel)]="cronExpr"
            name="cronExpr"
            required
            placeholder="0 9 * * *"
          />
          <span class="text-xs text-slate-500 block mt-1">
            {{ i18n.t('schedules_form_cron_hint') }}
          </span>
          <span class="text-xs text-slate-500 block">
            {{ i18n.t('schedule_form_tz_hint') }}
          </span>
        </label>
      }

      <label class="inline-flex items-center gap-2 text-sm">
        <input type="checkbox" [(ngModel)]="enabled" name="enabled" />
        <span>{{ i18n.t('schedules_form_enabled') }}</span>
      </label>

      <div class="flex justify-end gap-2 pt-2">
        <app-button type="submit">{{ i18n.t('schedules_form_submit') }}</app-button>
      </div>
    </form>
  `,
})
export class ScheduleFormComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly serviceIds = SERVICE_IDS;
  protected readonly frequencyTypes = FREQUENCY_TYPES;

  serviceId: ServiceId = 'CHKPROJ';
  frequencyType: FrequencyType = 'daily';
  enabled = true;

  dailyTime = '09:00';
  weeklyTime = '09:00';
  weeklyDow = 1;
  monthlyTime = '09:00';
  monthlyDom = 1;
  cronExpr = '0 9 * * *';

  @Input() set initial(cfg: ScheduleConfig | null | undefined) {
    if (!cfg) return;
    this.serviceId = cfg.serviceId;
    this.frequencyType = cfg.frequencyType;
    this.enabled = cfg.enabled;
    if (cfg.frequencyType === 'daily') this.dailyTime = cfg.frequencyValue;
    if (cfg.frequencyType === 'weekly') {
      const m = /^(\d{1,2}:\d{1,2}):(\d)$/.exec(cfg.frequencyValue);
      if (m) {
        this.weeklyTime = m[1]!;
        this.weeklyDow = Number(m[2]);
      }
    }
    if (cfg.frequencyType === 'monthly') {
      const m = /^(\d{1,2}:\d{1,2}):(\d{1,2})$/.exec(cfg.frequencyValue);
      if (m) {
        this.monthlyTime = m[1]!;
        this.monthlyDom = Number(m[2]);
      }
    }
    if (cfg.frequencyType === 'cron') this.cronExpr = cfg.frequencyValue;
  }

  @Output() submitted = new EventEmitter<ScheduleConfigInput>();

  frequencyLabel(ft: FrequencyType): string {
    if (ft === 'daily') return this.i18n.t('schedules_form_frequency_daily');
    if (ft === 'weekly') return this.i18n.t('schedules_form_frequency_weekly');
    if (ft === 'monthly') return this.i18n.t('schedules_form_frequency_monthly');
    return this.i18n.t('schedules_form_frequency_cron');
  }

  onSubmit(ev: Event): void {
    ev.preventDefault();
    const value = this.buildValue();
    if (!value) return;
    this.submitted.emit({
      serviceId: this.serviceId,
      frequencyType: this.frequencyType,
      frequencyValue: value,
      enabled: this.enabled,
    });
  }

  private buildValue(): string | null {
    if (this.frequencyType === 'daily') return this.dailyTime;
    if (this.frequencyType === 'weekly') return `${this.weeklyTime}:${this.weeklyDow}`;
    if (this.frequencyType === 'monthly') return `${this.monthlyTime}:${this.monthlyDom}`;
    return this.cronExpr.trim();
  }
}
