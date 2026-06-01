// T054：US3 專案檢查清單維護頁

import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { I18nService } from '../../core/i18n/i18n.service';
import { ButtonComponent } from '../../ui/button/button.component';
import { LoadingStateComponent } from '../../ui/loading-state/loading-state.component';
import { EmptyStateComponent } from '../../ui/empty-state/empty-state.component';
import { ErrorStateComponent } from '../../ui/error-state/error-state.component';
import {
  ProjectCheckListsApiService,
  type ProjectCheckListEntry,
} from './project-check-lists-api.service';

type State = 'idle' | 'loading' | 'error';

@Component({
  selector: 'app-project-check-lists-page',
  standalone: true,
  imports: [
    FormsModule,
    ButtonComponent,
    LoadingStateComponent,
    EmptyStateComponent,
    ErrorStateComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="space-y-4">
      <header>
        <h1 class="text-2xl font-semibold text-slate-900">
          {{ i18n.t('project_check_lists_title') }}
        </h1>
        <p class="mt-1 text-sm text-slate-600">
          {{ i18n.t('project_check_lists_subtitle') }}
        </p>
      </header>

      <form class="flex flex-wrap items-end gap-3 rounded-md bg-slate-50 p-3" (submit)="onAdd($event)">
        <label class="block text-sm">
          <span class="block text-slate-700">{{ i18n.t('project_check_lists_input_project') }}</span>
          <input
            type="text"
            class="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm font-mono"
            [(ngModel)]="newProjectKey"
            name="newProjectKey"
            placeholder="PAY"
            required
          />
        </label>
        <label class="block text-sm flex-1 min-w-[200px]">
          <span class="block text-slate-700">{{ i18n.t('project_check_lists_input_note') }}</span>
          <input
            type="text"
            class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            [(ngModel)]="newNote"
            name="newNote"
          />
        </label>
        <app-button type="submit">{{ i18n.t('project_check_lists_submit') }}</app-button>
      </form>

      @if (errorMsg()) {
        <div class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {{ errorMsg() }}
        </div>
      }

      @switch (state()) {
        @case ('loading') { <app-loading-state /> }
        @case ('error') { <app-error-state (retry)="load()" /> }
        @default {
          @if (items().length === 0) {
            <app-empty-state
              [title]="i18n.t('project_check_lists_empty_title')"
              [description]="i18n.t('project_check_lists_empty_description')"
            />
          } @else {
            <div class="overflow-x-auto rounded-md border border-slate-200 bg-white">
              <table class="min-w-full divide-y divide-slate-200 text-sm">
                <thead class="bg-slate-50">
                  <tr>
                    <th class="px-3 py-2 text-left">{{ i18n.t('project_check_lists_table_project') }}</th>
                    <th class="px-3 py-2 text-left">{{ i18n.t('project_check_lists_table_note') }}</th>
                    <th class="px-3 py-2 text-left">{{ i18n.t('project_check_lists_table_added_at') }}</th>
                    <th class="px-3 py-2 text-right">{{ i18n.t('project_check_lists_table_actions') }}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  @for (it of items(); track it.id) {
                    <tr>
                      <td class="px-3 py-2 font-mono font-medium">{{ it.projectKey }}</td>
                      <td class="px-3 py-2 text-slate-600">{{ it.note ?? '—' }}</td>
                      <td class="px-3 py-2 text-slate-600">{{ it.addedAt }}</td>
                      <td class="px-3 py-2 text-right">
                        <button
                          type="button"
                          class="text-rose-600 hover:underline"
                          (click)="onRemove(it)"
                        >
                          {{ i18n.t('project_check_lists_remove') }}
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
    </section>
  `,
})
export class ProjectCheckListsPageComponent {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(ProjectCheckListsApiService);

  newProjectKey = '';
  newNote = '';
  protected readonly items = signal<ProjectCheckListEntry[]>([]);
  protected readonly state = signal<State>('loading');
  protected readonly errorMsg = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.state.set('loading');
    this.errorMsg.set(null);
    try {
      const res = await firstValueFrom(this.api.list());
      this.items.set(res.items);
      this.state.set('idle');
    } catch {
      this.state.set('error');
    }
  }

  async onAdd(ev: Event): Promise<void> {
    ev.preventDefault();
    this.errorMsg.set(null);
    const key = this.newProjectKey.trim();
    if (!key) return;
    try {
      const input: { projectKey: string; note?: string } = { projectKey: key };
      if (this.newNote.trim()) input.note = this.newNote.trim();
      await firstValueFrom(this.api.add(input));
      this.newProjectKey = '';
      this.newNote = '';
      await this.load();
    } catch (err) {
      const status = (err as { status?: number })?.status;
      this.errorMsg.set(
        status === 409
          ? this.i18n.t('project_check_lists_conflict')
          : this.i18n.t('error_unexpected'),
      );
    }
  }

  async onRemove(it: ProjectCheckListEntry): Promise<void> {
    const msg = this.i18n.t('project_check_lists_remove_confirm').replace('{key}', it.projectKey);
    if (!confirm(msg)) return;
    try {
      await firstValueFrom(this.api.remove(it.id));
      await this.load();
    } catch {
      this.state.set('error');
    }
  }
}
