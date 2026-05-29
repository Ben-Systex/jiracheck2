import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withFetch } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';
import { Chart, registerables } from 'chart.js';
import { PeoplePageComponent } from './people.page';

Chart.register(...registerables);

const peopleResponse = {
  items: [
    { accountId: 'acc-1', displayName: 'Alice', email: 'alice@ex.com' },
    { accountId: 'acc-2', displayName: 'Bob', email: null },
  ],
};

const issuesResponse = {
  items: [
    {
      key: 'PAY-1',
      summary: 'Refactor charge flow',
      status: 'In Progress',
      projectKey: 'PAY',
      assignee: null,
      priority: null,
      dueDate: '2026-06-01',
      storyPoints: 5,
      actualStoryPoints: null,
      sprint: null,
      labels: [],
    },
  ],
  nextCursor: null,
  partialPermission: false,
  dataFreshness: { fetchedAt: new Date().toISOString(), source: 'live' },
};

describe('PeoplePageComponent', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PeoplePageComponent],
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

  it('shows empty state until person selected', () => {
    const fixture = TestBed.createComponent(PeoplePageComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('請先選擇成員');
  });

  it('renders search results and loads issues on select', async () => {
    const fixture = TestBed.createComponent(PeoplePageComponent);
    fixture.detectChanges();

    fixture.componentInstance.onSearch('a');
    const searchReq = httpMock.expectOne((r) => r.url.endsWith('/people/search'));
    expect(searchReq.request.params.get('q')).toBe('a');
    searchReq.flush(peopleResponse);

    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Alice');

    // 點 Alice
    fixture.componentInstance.selectPerson(peopleResponse.items[0]);
    const issuesReq = httpMock.expectOne((r) => r.url.includes('/people/acc-1/issues'));
    expect(issuesReq.request.params.get('status')).toBe('open');
    issuesReq.flush(issuesResponse);

    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Refactor charge flow');
    expect(fixture.nativeElement.textContent).toContain('PAY');
  });

  it('expandTo3Months sets ~3-month range and triggers stats request', async () => {
    const fixture = TestBed.createComponent(PeoplePageComponent);
    fixture.detectChanges();

    fixture.componentInstance.selectPerson(peopleResponse.items[0]);
    httpMock.expectOne((r) => r.url.includes('/people/acc-1/issues')).flush(issuesResponse);
    await fixture.whenStable();
    fixture.detectChanges();

    fixture.componentInstance.expandTo3Months();
    const statsReq = httpMock.expectOne((r) => r.url.includes('/people/acc-1/stats'));
    const from = statsReq.request.params.get('from')!;
    const to = statsReq.request.params.get('to')!;
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const diffMonths = (toDate.getFullYear() - fromDate.getFullYear()) * 12 + (toDate.getMonth() - fromDate.getMonth());
    expect(diffMonths).toBeGreaterThanOrEqual(2);
    expect(diffMonths).toBeLessThanOrEqual(3);
    statsReq.flush({
      from,
      to,
      totals: { completedCount: 0, storyPointsSum: 0, actualStoryPointsSum: 0, estimateAccuracyRatio: null },
      byProject: [],
      items: [],
      dataFreshness: { fetchedAt: new Date().toISOString(), source: 'live' },
    });
  });
});
