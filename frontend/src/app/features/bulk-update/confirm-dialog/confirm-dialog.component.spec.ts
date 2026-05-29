import { TestBed } from '@angular/core/testing';
import { BulkConfirmDialogComponent } from './confirm-dialog.component';

describe('BulkConfirmDialogComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [BulkConfirmDialogComponent] }).compileComponents();
  });

  it('disables confirm until text matches exactly', async () => {
    const fixture = TestBed.createComponent(BulkConfirmDialogComponent);
    fixture.componentInstance.totalCount = 35;
    fixture.detectChanges();
    const btn = (fixture.nativeElement.querySelectorAll('button')[1]) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = '更新 35 筆';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(btn.disabled).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('格式不符');

    input.value = '確認更新 34 筆';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(btn.disabled).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('N 必須等於本次預覽筆數 35');

    input.value = '確認更新 35 筆';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(btn.disabled).toBe(false);
  });

  it('emits confirmed with payload on click', async () => {
    const fixture = TestBed.createComponent(BulkConfirmDialogComponent);
    fixture.componentInstance.totalCount = 12;
    let payload: { confirmText: string; confirmCount: number } | undefined;
    fixture.componentInstance.confirmed.subscribe((p) => (payload = p));
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = '確認更新 12 筆';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const btn = (fixture.nativeElement.querySelectorAll('button')[1]) as HTMLButtonElement;
    btn.click();
    expect(payload).toEqual({ confirmText: '確認更新 12 筆', confirmCount: 12 });
  });
});
