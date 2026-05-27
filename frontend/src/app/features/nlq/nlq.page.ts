// T054 + T057 + T058：US2 NLQ 頁
// - 1000 字輸入框 + submit
// - status=ok → explanation + result + freshness-bar（FR-003）
// - status=clarification_needed → 補充問題清單（acceptance #3）
// - status=partial_permission → 顯著標示（acceptance #4 / FR-024）
// - truncated（result > 1000）→ 顯示縮小範圍提示（T058）
// - 過長輸入 → 即時禁用送出

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { I18nService } from '../../core/i18n/i18n.service';
import { ButtonComponent } from '../../ui/button/button.component';
import { LoadingStateComponent } from '../../ui/loading-state/loading-state.component';
import { ErrorStateComponent } from '../../ui/error-state/error-state.component';
import { FreshnessBarComponent } from '../../ui/freshness-bar/freshness-bar.component';
import { NlqResultRendererComponent } from './result-renderer/result-renderer.component';
import {
  NlqApiService,
  type NlqResponse,
} from './nlq-api.service';

const MAX_LEN = 1000;
const TRUNCATE_THRESHOLD = 1000;

@Component({
  selector: 'app-nlq-page',
  standalone: true,
  imports: [
    FormsModule,
    ButtonComponent,
    LoadingStateComponent,
    ErrorStateComponent,
    FreshnessBarComponent,
    NlqResultRendererComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="space-y-4">
      <header>
        <h1 class="text-2xl font-semibold text-slate-900">{{ i18n.t('nlq_title') }}</h1>
        <p class="mt-1 text-sm text-slate-600">{{ i18n.t('nlq_subtitle') }}</p>
      </header>

      <form class="space-y-2" (submit)="onSubmit($event)">
        <label class="block">
          <span class="text-sm text-slate-700">{{ i18n.t('nlq_input_label') }}</span>
          <textarea
            class="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            rows="3"
            [placeholder]="i18n.t('nlq_input_placeholder')"
            [maxlength]="maxLength"
            [(ngModel)]="question"
            name="question"
            required
            aria-describedby="nlq-input-hint"
          ></textarea>
        </label>
        <p id="nlq-input-hint" class="text-xs text-slate-500">
          {{ question.length }} / {{ maxLength }}
        </p>
        @if (question.length >= maxLength) {
          <p class="text-xs text-amber-700" role="status">{{ i18n.t('nlq_too_long') }}</p>
        }
        <app-button type="submit" variant="primary" [disabled]="!canSubmit()">
          {{ i18n.t('nlq_submit') }}
        </app-button>
      </form>

      @if (loading()) { <app-loading-state /> }
      @if (errorMessage(); as msg) {
        <app-error-state [description]="msg" (retry)="onRetry()" />
      }

      @if (response(); as r) {
        <section class="rounded-md border border-slate-200 bg-white p-4 space-y-2">
          <h2 class="text-sm font-semibold text-slate-900">{{ i18n.t('nlq_explanation_heading') }}</h2>
          <p class="text-sm text-slate-700">{{ r.explanationZh }}</p>
        </section>

        @if (r.status === 'clarification_needed' && r.clarificationQuestions?.length) {
          <section class="rounded-md border border-amber-200 bg-amber-50 p-4 space-y-2" role="status">
            <h2 class="text-sm font-semibold text-amber-900">{{ i18n.t('nlq_clarification_heading') }}</h2>
            <ul class="list-disc pl-5 text-sm text-amber-900">
              @for (q of r.clarificationQuestions!; track q) {
                <li>{{ q }}</li>
              }
            </ul>
          </section>
        }

        @if (r.status === 'partial_permission') {
          <p class="rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-800" role="status">
            {{ i18n.t('nlq_partial_permission') }}
          </p>
        }

        @if (truncated()) {
          <p class="rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-800" role="status">
            {{ i18n.t('nlq_truncated') }}
          </p>
        }

        @if (r.results && r.plan) {
          <section class="space-y-2">
            <header class="flex items-baseline justify-between">
              <h2 class="text-sm font-semibold text-slate-900">{{ i18n.t('nlq_result_heading') }}</h2>
            </header>
            @if (r.dataFreshness) {
              <app-freshness-bar [freshness]="r.dataFreshness" (refresh)="onRetry()" />
            }
            <app-nlq-result-renderer
              [intent]="r.plan.intent"
              [response]="r"
            />
          </section>
        }
      }
    </section>
  `,
})
export class NlqPageComponent {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(NlqApiService);

  protected readonly maxLength = MAX_LEN;
  protected question = '';

  protected readonly response = signal<NlqResponse | null>(null);
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | undefined>(undefined);

  protected readonly truncated = computed<boolean>(() => {
    const r = this.response();
    if (!r || !r.results) return false;
    const items = r.results['items'];
    return Array.isArray(items) && items.length >= TRUNCATE_THRESHOLD;
  });

  canSubmit(): boolean {
    return this.question.trim().length > 0 && this.question.length <= this.maxLength && !this.loading();
  }

  async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.canSubmit()) return;
    await this.runQuery();
  }

  async onRetry(): Promise<void> {
    if (!this.canSubmit()) return;
    await this.runQuery();
  }

  private async runQuery(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set(undefined);
    try {
      const res = await firstValueFrom(this.api.query({ question: this.question.trim() }));
      this.response.set(res);
    } catch (err) {
      this.errorMessage.set(extractMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}

function extractMessage(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'title' in err) {
    return String((err as { title: unknown }).title);
  }
  return undefined;
}
