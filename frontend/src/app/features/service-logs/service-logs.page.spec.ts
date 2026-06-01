// T043：service-logs.page 單元測試
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import {
  provideHttpClientTesting,
  HttpTestingController,
} from '@angular/common/http/testing';
import { ServiceLogsPageComponent } from './service-logs.page';
import type { ServiceLogSummary } from './service-logs-api.service';

function mkSummary(over: Partial<ServiceLogSummary> = {}): ServiceLogSummary {
  return {
    id: 'sl-1',
    scheduleId: null,
    serviceId: 'CHKPROJ',
    triggeredBy: 'manual',
    startedAt: '2026-05-29T00:00:00.000Z',
    endedAt: '2026-05-29T00:01:00.000Z',
    result: 'success',
    summary: 'OK',
    ruleVersion: null,
    ...over,
  };
}

describe('ServiceLogsPageComponent', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ServiceLogsPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('載入後填入 items', async () => {
    const fixture = TestBed.createComponent(ServiceLogsPageComponent);
    fixture.detectChanges();
    const req = http.expectOne((r) => r.method === 'GET' && r.url.endsWith('/service-logs'));
    req.flush({ items: [mkSummary(), mkSummary({ id: 'sl-2' })], nextCursor: null });
    await fixture.whenStable();
    expect(fixture.componentInstance['items']().length).toBe(2);
    expect(fixture.componentInstance['nextCursor']()).toBeNull();
  });

  it('list 失敗 → state=error', async () => {
    const fixture = TestBed.createComponent(ServiceLogsPageComponent);
    fixture.detectChanges();
    const req = http.expectOne((r) => r.url.endsWith('/service-logs'));
    req.flush({}, { status: 500, statusText: 'err' });
    await fixture.whenStable();
    expect(fixture.componentInstance['state']()).toBe('error');
  });

  it('onFilter 帶 serviceId 觸發 reload', async () => {
    const fixture = TestBed.createComponent(ServiceLogsPageComponent);
    fixture.detectChanges();
    http.expectOne((r) => r.url.endsWith('/service-logs')).flush({ items: [], nextCursor: null });
    await fixture.whenStable();

    fixture.componentInstance.serviceId = 'CHKPROJ';
    fixture.componentInstance.onFilter({ preventDefault: () => undefined } as unknown as Event);

    const req = http.expectOne((r) => r.url.endsWith('/service-logs') && r.params.get('serviceId') === 'CHKPROJ');
    req.flush({ items: [mkSummary()], nextCursor: null });
    await fixture.whenStable();
    expect(fixture.componentInstance['items']().length).toBe(1);
  });

  it('onLoadMore 用 cursor 接續', async () => {
    const fixture = TestBed.createComponent(ServiceLogsPageComponent);
    fixture.detectChanges();
    http
      .expectOne((r) => r.url.endsWith('/service-logs'))
      .flush({ items: [mkSummary({ id: 'a' })], nextCursor: 'c1' });
    await fixture.whenStable();
    expect(fixture.componentInstance['nextCursor']()).toBe('c1');

    void fixture.componentInstance.onLoadMore();
    const req = http.expectOne((r) => r.url.endsWith('/service-logs') && r.params.get('cursor') === 'c1');
    req.flush({ items: [mkSummary({ id: 'b' })], nextCursor: null });
    await fixture.whenStable();
    expect(fixture.componentInstance['items']().map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('exportHref 含 filter query string', async () => {
    const fixture = TestBed.createComponent(ServiceLogsPageComponent);
    fixture.detectChanges();
    http.expectOne((r) => r.url.endsWith('/service-logs')).flush({ items: [], nextCursor: null });
    await fixture.whenStable();

    fixture.componentInstance.serviceId = 'CHKPROJ';
    fixture.componentInstance.result = 'failure';
    const href = fixture.componentInstance.exportHref();
    expect(href).toContain('/service-logs/export');
    expect(href).toContain('serviceId=CHKPROJ');
    expect(href).toContain('result=failure');
  });
});
