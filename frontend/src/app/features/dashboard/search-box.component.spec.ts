import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { SearchBoxComponent } from './search-box.component';

describe('SearchBoxComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SearchBoxComponent] }).compileComponents();
  });

  it('debounces queryChange by 500ms and emits trimmed value', fakeAsync(() => {
    const fixture = TestBed.createComponent(SearchBoxComponent);
    const emitted: string[] = [];
    fixture.componentInstance.queryChange.subscribe((q) => emitted.push(q));
    fixture.detectChanges();

    fixture.componentInstance.onInput(' pay ');
    fixture.componentInstance.onInput(' payment ');
    tick(499);
    expect(emitted).toEqual([]);
    tick(1);
    expect(emitted).toEqual(['payment']);
  }));

  it('ignores duplicate trimmed values via distinctUntilChanged', fakeAsync(() => {
    const fixture = TestBed.createComponent(SearchBoxComponent);
    const emitted: string[] = [];
    fixture.componentInstance.queryChange.subscribe((q) => emitted.push(q));
    fixture.detectChanges();

    fixture.componentInstance.onInput('pay');
    tick(500);
    fixture.componentInstance.onInput('pay');
    tick(500);
    expect(emitted).toEqual(['pay']);
  }));
});
