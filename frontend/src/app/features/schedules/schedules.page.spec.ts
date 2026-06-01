// T032：schedules.page 單元測試
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  provideHttpClientTesting,
  HttpTestingController,
} from '@angular/common/http/testing';
import { SchedulesPageComponent } from './schedules.page';
import type { ScheduleConfig } from './schedules-api.service';

const NOW_ISO = '2026-05-30T00:00:00.000Z';

function mkCfg(over: Partial<ScheduleConfig> = {}): ScheduleConfig {
  return {
    id: 'sc-1',
    serviceId: 'CHKPROJ',
    frequencyType: 'daily',
    frequencyValue: '09:00',
    enabled: true,
    nextRunAt: NOW_ISO,
    lastRunAt: null,
    createdBy: 'u-1',
    updatedBy: 'u-1',
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    ...over,
  };
}

describe('SchedulesPageComponent', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SchedulesPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('載入後填入 items', async () => {
    const fixture = TestBed.createComponent(SchedulesPageComponent);
    fixture.detectChanges(); // 觸發 constructor + load
    const req = http.expectOne((r) => r.method === 'GET' && r.url.endsWith('/schedules'));
    req.flush({ items: [mkCfg(), mkCfg({ id: 'sc-2', enabled: false })] });
    await fixture.whenStable();
    expect(fixture.componentInstance['items']().length).toBe(2);
  });

  it('list 失敗 → state=error', async () => {
    const fixture = TestBed.createComponent(SchedulesPageComponent);
    fixture.detectChanges();
    const req = http.expectOne((r) => r.method === 'GET' && r.url.endsWith('/schedules'));
    req.flush({}, { status: 500, statusText: 'err' });
    await fixture.whenStable();
    expect(fixture.componentInstance['state']()).toBe('error');
  });

  it('onNew → showForm=true、editing=null', async () => {
    const fixture = TestBed.createComponent(SchedulesPageComponent);
    fixture.detectChanges();
    http.expectOne((r) => r.url.endsWith('/schedules')).flush({ items: [] });
    await fixture.whenStable();
    fixture.componentInstance.onNew();
    expect(fixture.componentInstance['showForm']()).toBe(true);
    expect(fixture.componentInstance['editing']()).toBeNull();
  });

  it('onEdit → showForm=true、editing=cfg', async () => {
    const fixture = TestBed.createComponent(SchedulesPageComponent);
    fixture.detectChanges();
    http.expectOne((r) => r.url.endsWith('/schedules')).flush({ items: [] });
    await fixture.whenStable();
    const cfg = mkCfg();
    fixture.componentInstance.onEdit(cfg);
    expect(fixture.componentInstance['showForm']()).toBe(true);
    expect(fixture.componentInstance['editing']()?.id).toBe('sc-1');
  });

  it('onSubmitted (create) → 呼叫 POST /schedules + 重新 list', async () => {
    const fixture = TestBed.createComponent(SchedulesPageComponent);
    fixture.detectChanges();
    http.expectOne((r) => r.url.endsWith('/schedules')).flush({ items: [] });
    await fixture.whenStable();

    void fixture.componentInstance.onSubmitted({
      serviceId: 'CHKPROJ',
      frequencyType: 'daily',
      frequencyValue: '09:00',
      enabled: true,
    });

    const post = http.expectOne((r) => r.method === 'POST' && r.url.endsWith('/schedules'));
    expect(post.request.body.serviceId).toBe('CHKPROJ');
    post.flush(mkCfg());

    await fixture.whenStable();
    const reload = http.expectOne((r) => r.method === 'GET' && r.url.endsWith('/schedules'));
    reload.flush({ items: [mkCfg()] });
    await fixture.whenStable();

    expect(fixture.componentInstance['showForm']()).toBe(false);
    expect(fixture.componentInstance['items']().length).toBe(1);
  });
});
