import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withFetch } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';
import { Chart, registerables } from 'chart.js';
import { DashboardPageComponent } from './dashboard.page';

Chart.register(...registerables);

const recentResponse = {
  items: [
    {
      key: 'PAY',
      name: 'Payments',
      openIssueCount: 5,
      sprintProgress: { completedSP: 3, totalSP: 8, sprintName: 'S1' },
      lastAccessedAt: new Date().toISOString(),
    },
  ],
  dataFreshness: { fetchedAt: new Date().toISOString(), source: 'live' },
};

describe('DashboardPageComponent', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardPageComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
        provideCharts(withDefaultRegisterables()),
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('loads recent on init and renders cards', async () => {
    const fixture = TestBed.createComponent(DashboardPageComponent);
    fixture.detectChanges();
    const req = httpMock.expectOne((r) => r.url.endsWith('/projects/recent'));
    expect(req.request.method).toBe('GET');
    req.flush(recentResponse);
    await fixture.whenStable();
    fixture.detectChanges();
    const txt = fixture.nativeElement.textContent as string;
    expect(txt).toContain('Payments');
    expect(txt).toContain('未完成 5');
  });

  it('switches to search when query is non-empty', async () => {
    const fixture = TestBed.createComponent(DashboardPageComponent);
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url.endsWith('/projects/recent')).flush(recentResponse);
    await fixture.whenStable();
    fixture.detectChanges();

    fixture.componentInstance.onQueryChange('pay');
    const req = httpMock.expectOne((r) => r.url.endsWith('/projects/search'));
    expect(req.request.params.get('q')).toBe('pay');
    req.flush({
      items: [{ ...recentResponse.items[0], openIssueCount: 0, sprintProgress: null }],
      dataFreshness: { fetchedAt: new Date().toISOString(), source: 'live' },
    });
    await fixture.whenStable();
    fixture.detectChanges();
    const txt = fixture.nativeElement.textContent as string;
    expect(txt).toContain('Payments');
  });

  it('shows empty-state when recent is empty', async () => {
    const fixture = TestBed.createComponent(DashboardPageComponent);
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url.endsWith('/projects/recent')).flush({
      items: [],
      dataFreshness: { fetchedAt: new Date().toISOString(), source: 'live' },
    });
    await fixture.whenStable();
    fixture.detectChanges();
    const txt = fixture.nativeElement.textContent as string;
    expect(txt).toContain('尚未存取任何專案');
  });

  it('shows error-state on backend problem', async () => {
    const fixture = TestBed.createComponent(DashboardPageComponent);
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url.endsWith('/projects/recent')).flush(
      { title: 'Jira 服務暫時無法連線', cause: 'upstream', status: 502, type: 'x' },
      { status: 502, statusText: 'Bad Gateway' },
    );
    await fixture.whenStable();
    fixture.detectChanges();
    const txt = fixture.nativeElement.textContent as string;
    expect(txt).toContain('發生錯誤');
  });
});
