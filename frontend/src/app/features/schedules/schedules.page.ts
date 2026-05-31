// T027：US1 排程列表 / CRUD / 立即執行頁面

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { I18nService } from '../../core/i18n/i18n.service';
import { ButtonComponent } from '../../ui/button/button.component';
import { LoadingStateComponent } from '../../ui/loading-state/loading-state.component';
import { EmptyStateComponent } from '../../ui/empty-state/empty-state.component';
import { ErrorStateComponent } from '../../ui/error-state/error-state.component';
import { ScheduleFormComponent } from './schedule-form/schedule-form.component';
import {
  SchedulesApiService,
  type ScheduleConfig,
  type ScheduleConfigInput,
} from './schedules-api.service';

type State = 'idle' | 'loading' | 'error';

@Component({
  selector: 'app-schedules-page',
  standalone: true,
  imports: [
    ButtonComponent,
    LoadingStateComponent,
    EmptyStateComponent,
    ErrorStateComponent,
    ScheduleFormComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="space-y-4">
      <header class="flex items-start justify-between">
        <div>
          <h1 class="text-2xl font-semibold text-slate-900">{{ i18n.t('schedules_title') }}</h1>
          <p class="mt-1 text-sm text-slate-600">{{ i18n.t('schedules_subtitle') }}</p>
        </div>
        @if (!showForm()) {
          <app-button (click)="onNew()">{{ i18n.t('schedules_new') }}</app-button>
        }
      </header>

      @if (showForm()) {
        <div class="rounded-md border border-slate-200 bg-white p-4">
          <app-schedule-form
            [initial]="editing()"
            (submitted)="onSubmitted($event)"
          />
          <div class="mt-2 flex justify-end">
            <button type="button" class="text-sm text-slate-500 hover:text-slate-700"
              (click)="onCancelForm()">
              {{ i18n.t('common_cancel') }}
            </button>
          </div>
        </div>
      }

      @switch (state()) {
        @case ('loading') {
          <app-loading-state />
        }
        @case ('error') {
          <app-error-state (retry)="load()" />
        }
        @default {
          @if (items().length === 0) {
            <app-empty-state
              [title]="i18n.t('schedules_empty_title')"
              [description]="i18n.t('schedules_empty_description')"
            />
          } @else {
            <div class="overflow-x-auto rounded-md border border-slate-200 bg-white">
              <table class="min-w-full divide-y divide-slate-200 text-sm">
                <thead class="bg-slate-50">
                  <tr>
                    <th class="px-3 py-2 text-left">{{ i18n.t('schedules_table_service') }}</th>
                    <th class="px-3 py-2 text-left">{{ i18n.t('schedules_table_frequency') }}</th>
                    <th class="px-3 py-2 text-left">{{ i18n.t('schedules_table_next_run') }}</th>
                    <th class="px-3 py-2 text-left">{{ i18n.t('schedules_table_enabled') }}</th>
                    <th class="px-3 py-2 text-right">{{ i18n.t('schedules_table_actions') }}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  @for (it of items(); track it.id) {
                    <tr>
                      <td class="px-3 py-2 font-medium">{{ it.serviceId }}</td>
                      <td class="px-3 py-2 font-mono text-xs">
                        {{ it.frequencyType }} · {{ it.frequencyValue }}
                      </td>
                      <td class="px-3 py-2 text-slate-600">{{ it.nextRunAt ?? '—' }}</td>
                      <td class="px-3 py-2">
                        {{ it.enabled ? '✓' : '—' }}
                      </td>
                      <td class="px-3 py-2 text-right space-x-2">
                        <button
                          type="button"
                          class="text-blue-600 hover:underline"
                          (click)="onTrigger(it)"
                        >
                          {{ i18n.t('schedules_action_trigger') }}
                        </button>
                        <button
                          type="button"
                          class="text-slate-700 hover:underline"
                          (click)="onEdit(it)"
                        >
                          {{ i18n.t('schedules_action_edit') }}
                        </button>
                        <button
                          type="button"
                          class="text-rose-600 hover:underline"
                          (click)="onDelete(it)"
                        >
                          {{ i18n.t('schedules_action_delete') }}
                        </button>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        }
      }

      @if (toast()) {
        <div class="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">
          {{ toast() }}
        </div>
      }
    </section>
  `,
})
export class SchedulesPageComponent {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(SchedulesApiService);

  protected readonly items = signal<ScheduleConfig[]>([]);
  protected readonly state = signal<State>('loading');
  protected readonly editing = signal<ScheduleConfig | null>(null);
  protected readonly showForm = signal(false);
  protected readonly toast = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.state.set('loading');
    try {
      const res = await firstValueFrom(this.api.list());
      this.items.set(res.items);
      this.state.set('idle');
    } catch {
      this.state.set('error');
    }
  }

  onNew(): void {
    this.editing.set(null);
    this.showForm.set(true);
  }

  onEdit(cfg: ScheduleConfig): void {
    this.editing.set(cfg);
    this.showForm.set(true);
  }

  onCancelForm(): void {
    this.showForm.set(false);
    this.editing.set(null);
  }

  async onSubmitted(input: ScheduleConfigInput): Promise<void> {
    const cur = this.editing();
    try {
      if (cur) {
        await firstValueFrom(this.api.update(cur.id, input));
      } else {
        await firstValueFrom(this.api.create(input));
      }
      this.showForm.set(false);
      this.editing.set(null);
      await this.load();
    } catch {
      this.state.set('error');
    }
  }

  async onTrigger(cfg: ScheduleConfig): Promise<void> {
    try {
      await firstValueFrom(this.api.trigger(cfg.id));
      this.flashToast(this.i18n.t('schedules_trigger_started'));
    } catch {
      this.flashToast(this.i18n.t('schedules_trigger_skipped'));
    }
  }

  async onDelete(cfg: ScheduleConfig): Promise<void> {
    if (!confirm(this.i18n.t('schedules_delete_confirm'))) return;
    try {
      await firstValueFrom(this.api.delete(cfg.id));
      await this.load();
    } catch {
      this.state.set('error');
    }
  }

  private flashToast(msg: string): void {
    this.toast.set(msg);
    setTimeout(() => this.toast.set(null), 3000);
  }
}
