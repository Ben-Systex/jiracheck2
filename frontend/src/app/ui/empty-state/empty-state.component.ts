import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

@Component({
  selector: 'app-empty-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      role="status"
      aria-live="polite"
      class="flex flex-col items-center justify-center py-12 text-center text-slate-600"
    >
      <p class="text-base font-medium">{{ title }}</p>
      @if (description) {
        <p class="mt-1 text-sm text-slate-500">{{ description }}</p>
      }
      <ng-content />
    </div>
  `,
})
export class EmptyStateComponent {
  @Input({ required: true }) title!: string;
  @Input() description?: string;
}
