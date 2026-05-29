import { TestBed } from '@angular/core/testing';
import { FreshnessBarComponent } from './freshness-bar.component';

describe('FreshnessBarComponent', () => {
  it('renders relative time for fresh data', async () => {
    await TestBed.configureTestingModule({ imports: [FreshnessBarComponent] }).compileComponents();
    const fixture = TestBed.createComponent(FreshnessBarComponent);
    fixture.componentInstance.freshness = {
      fetchedAt: new Date(Date.now() - 30_000).toISOString(),
      source: 'live',
    };
    fixture.detectChanges();
    const txt = fixture.nativeElement.textContent as string;
    expect(txt).toContain('剛剛');
    expect(txt).toContain('即時');
    expect(txt).toContain('重新整理');
  });

  it('shows cache badge when source=cache', async () => {
    await TestBed.configureTestingModule({ imports: [FreshnessBarComponent] }).compileComponents();
    const fixture = TestBed.createComponent(FreshnessBarComponent);
    fixture.componentInstance.freshness = {
      fetchedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      source: 'cache',
      cacheTtlSeconds: 30,
    };
    fixture.detectChanges();
    const txt = fixture.nativeElement.textContent as string;
    expect(txt).toContain('快取');
    expect(txt).toContain('5 分鐘前');
  });

  it('emits refresh on button click', async () => {
    await TestBed.configureTestingModule({ imports: [FreshnessBarComponent] }).compileComponents();
    const fixture = TestBed.createComponent(FreshnessBarComponent);
    fixture.componentInstance.freshness = {
      fetchedAt: new Date().toISOString(),
      source: 'live',
    };
    let fired = 0;
    fixture.componentInstance.refresh.subscribe(() => (fired += 1));
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    btn.click();
    expect(fired).toBe(1);
  });
});
