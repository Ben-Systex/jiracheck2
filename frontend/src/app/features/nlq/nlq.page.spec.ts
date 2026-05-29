import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withFetch } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { NlqPageComponent } from './nlq.page';

const okCount = {
  explanationZh: '統計符合條件的任務數，專案 PAY',
  plan: { intent: 'count_issues', filters: { projectKeys: ['PAY'] } },
  status: 'ok',
  results: { count: 7 },
  dataFreshness: { fetchedAt: new Date().toISOString(), source: 'live' },
};

const clarification = {
  explanationZh: '系統無法解讀，請補充必要資訊',
  plan: null,
  status: 'clarification_needed',
  clarificationQuestions: ['請補充時間範圍？', '請指定專案？'],
};

const partial = {
  explanationZh: '列出符合條件的任務',
  plan: { intent: 'list_issues', filters: {} },
  status: 'partial_permission',
  results: { items: [{ key: 'X-1', summary: 's', status: 'In Progress', projectKey: 'X', assignee: null }] },
};

describe('NlqPageComponent', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NlqPageComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('renders count_issues result + freshness-bar on ok', async () => {
    const fixture = TestBed.createComponent(NlqPageComponent);
    fixture.detectChanges();
    fixture.componentInstance['question'] = 'PAY 已完成多少筆';
    void fixture.componentInstance.onSubmit(new Event('submit'));
    const req = httpMock.expectOne((r) => r.url.endsWith('/nlq/query'));
    expect(req.request.body).toEqual({ question: 'PAY 已完成多少筆' });
    req.flush(okCount);
    await fixture.whenStable();
    fixture.detectChanges();
    const txt = fixture.nativeElement.textContent as string;
    expect(txt).toContain('統計符合條件的任務數');
    expect(txt).toContain('7');
    expect(txt).toContain('即時');
  });

  it('renders clarification questions when status=clarification_needed', async () => {
    const fixture = TestBed.createComponent(NlqPageComponent);
    fixture.detectChanges();
    fixture.componentInstance['question'] = '我做了多少';
    void fixture.componentInstance.onSubmit(new Event('submit'));
    httpMock.expectOne((r) => r.url.endsWith('/nlq/query')).flush(clarification);
    await fixture.whenStable();
    fixture.detectChanges();
    const txt = fixture.nativeElement.textContent as string;
    expect(txt).toContain('請補充以下資訊');
    expect(txt).toContain('請補充時間範圍？');
    expect(txt).toContain('請指定專案？');
  });

  it('renders partial_permission banner', async () => {
    const fixture = TestBed.createComponent(NlqPageComponent);
    fixture.detectChanges();
    fixture.componentInstance['question'] = '列出 X 任務';
    void fixture.componentInstance.onSubmit(new Event('submit'));
    httpMock.expectOne((r) => r.url.endsWith('/nlq/query')).flush(partial);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('部分結果因權限限制未顯示');
  });

  it('disables submit when input empty', () => {
    const fixture = TestBed.createComponent(NlqPageComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.canSubmit()).toBe(false);
    fixture.componentInstance['question'] = '   ';
    expect(fixture.componentInstance.canSubmit()).toBe(false);
    fixture.componentInstance['question'] = '查 PAY';
    expect(fixture.componentInstance.canSubmit()).toBe(true);
  });
});
