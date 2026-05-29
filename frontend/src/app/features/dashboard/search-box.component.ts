// T038：US1 dashboard 搜尋輸入
// - RxJS debounce 500ms（符合 spec acceptance #3）
// - emits 「目前的字串」；上層元件決定打不打 API
// - 提供 aria-label，可由鍵盤操作

import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  OnDestroy,
  OnInit,
  Output,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription, debounceTime, distinctUntilChanged } from 'rxjs';
import { I18nService } from '../../core/i18n/i18n.service';

@Component({
  selector: 'app-search-box',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="block">
      <span class="sr-only">{{ i18n.t('dashboard_search_aria') }}</span>
      <input
        type="search"
        [placeholder]="i18n.t('dashboard_search_placeholder')"
        [attr.aria-label]="i18n.t('dashboard_search_aria')"
        class="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        [ngModel]="value"
        (ngModelChange)="onInput($event)"
      />
    </label>
  `,
})
export class SearchBoxComponent implements OnInit, OnDestroy {
  protected readonly i18n = inject(I18nService);
  protected value = '';
  private readonly subject = new Subject<string>();
  private sub: Subscription | undefined;

  @Output() readonly queryChange = new EventEmitter<string>();

  ngOnInit(): void {
    this.sub = this.subject
      .pipe(debounceTime(500), distinctUntilChanged())
      .subscribe((q) => this.queryChange.emit(q));
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  onInput(v: string): void {
    this.value = v;
    this.subject.next(v.trim());
  }
}
