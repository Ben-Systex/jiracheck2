// T031：schedule-form 單元測試
import { TestBed } from '@angular/core/testing';
import { ScheduleFormComponent } from './schedule-form.component';
import type { ScheduleConfigInput } from '../schedules-api.service';

describe('ScheduleFormComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ScheduleFormComponent] }).compileComponents();
  });

  function build(): ScheduleFormComponent {
    const f = TestBed.createComponent(ScheduleFormComponent);
    f.detectChanges();
    return f.componentInstance;
  }

  it('預設值 daily 09:00 enabled=true → submitted 帶完整 input', () => {
    const c = build();
    let emitted: ScheduleConfigInput | undefined;
    c.submitted.subscribe((v) => (emitted = v));
    c.onSubmit({ preventDefault() {} } as Event);
    expect(emitted).toEqual({
      serviceId: 'CHKPROJ',
      frequencyType: 'daily',
      frequencyValue: '09:00',
      enabled: true,
    });
  });

  it('weekly：組合 HH:MM:DOW', () => {
    const c = build();
    c.frequencyType = 'weekly';
    c.weeklyTime = '10:30';
    c.weeklyDow = 3;
    let emitted: ScheduleConfigInput | undefined;
    c.submitted.subscribe((v) => (emitted = v));
    c.onSubmit({ preventDefault() {} } as Event);
    expect(emitted?.frequencyValue).toBe('10:30:3');
  });

  it('monthly：組合 HH:MM:DOM', () => {
    const c = build();
    c.frequencyType = 'monthly';
    c.monthlyTime = '08:00';
    c.monthlyDom = 15;
    let emitted: ScheduleConfigInput | undefined;
    c.submitted.subscribe((v) => (emitted = v));
    c.onSubmit({ preventDefault() {} } as Event);
    expect(emitted?.frequencyValue).toBe('08:00:15');
  });

  it('cron：原樣傳出', () => {
    const c = build();
    c.frequencyType = 'cron';
    c.cronExpr = '*/5 * * * *';
    let emitted: ScheduleConfigInput | undefined;
    c.submitted.subscribe((v) => (emitted = v));
    c.onSubmit({ preventDefault() {} } as Event);
    expect(emitted?.frequencyType).toBe('cron');
    expect(emitted?.frequencyValue).toBe('*/5 * * * *');
  });

  it('initial setter：daily', () => {
    const c = build();
    c.initial = {
      id: 'sc-1',
      serviceId: 'CHKISSUE',
      frequencyType: 'daily',
      frequencyValue: '14:30',
      enabled: false,
      nextRunAt: null,
      lastRunAt: null,
      createdBy: 'u-1',
      updatedBy: 'u-1',
      createdAt: '',
      updatedAt: '',
    };
    expect(c.serviceId).toBe('CHKISSUE');
    expect(c.dailyTime).toBe('14:30');
    expect(c.enabled).toBe(false);
  });

  it('initial setter：weekly 解析 HH:MM:DOW', () => {
    const c = build();
    c.initial = {
      id: 'sc-1',
      serviceId: 'CHKPROJ',
      frequencyType: 'weekly',
      frequencyValue: '11:00:5',
      enabled: true,
      nextRunAt: null,
      lastRunAt: null,
      createdBy: 'u-1',
      updatedBy: 'u-1',
      createdAt: '',
      updatedAt: '',
    };
    expect(c.weeklyTime).toBe('11:00');
    expect(c.weeklyDow).toBe(5);
  });
});
