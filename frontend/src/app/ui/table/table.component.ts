import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * 簡易表格容器 — 細節欄位由 caller 自填 <thead>/<tbody>。
 * 此元件只統一外觀、確保語意 <table> + ARIA。
 */
@Component({
  selector: 'app-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="overflow-x-auto rounded-md border border-slate-200">
      <table class="min-w-full divide-y divide-slate-200 text-sm">
        <ng-content />
      </table>
    </div>
  `,
})
export class TableComponent {}
