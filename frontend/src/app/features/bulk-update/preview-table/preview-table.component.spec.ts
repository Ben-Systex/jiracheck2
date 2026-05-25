import { TestBed } from '@angular/core/testing';
import { BulkPreviewTableComponent } from './preview-table.component';

describe('BulkPreviewTableComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [BulkPreviewTableComponent] }).compileComponents();
  });

  it('disables apply when no editable item', () => {
    const fixture = TestBed.createComponent(BulkPreviewTableComponent);
    fixture.componentInstance.totalCount = 2;
    fixture.componentInstance.items = [
      { issueKey: 'A-1', summary: 'a', currentValue: null, proposedValue: 'x', editableByUser: false },
      { issueKey: 'A-2', summary: 'b', currentValue: null, proposedValue: 'x', editableByUser: false },
    ];
    fixture.detectChanges();
    const btns = fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
    const applyBtn = btns[btns.length - 1]!;
    expect(applyBtn.disabled).toBe(true);
  });

  it('shows over-limit warning when totalCount >= 200', () => {
    const fixture = TestBed.createComponent(BulkPreviewTableComponent);
    fixture.componentInstance.totalCount = 200;
    fixture.componentInstance.items = [];
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('已達 200 筆上限');
  });

  it('display() handles assignee object → displayName', () => {
    const fixture = TestBed.createComponent(BulkPreviewTableComponent);
    expect(fixture.componentInstance.display({ accountId: 'a', displayName: 'Alice' })).toBe('Alice');
    expect(fixture.componentInstance.display(['x', 'y'])).toBe('x, y');
    expect(fixture.componentInstance.display(null)).toBe('—');
  });
});
