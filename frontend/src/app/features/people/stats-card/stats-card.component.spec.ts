import { TestBed } from '@angular/core/testing';
import { Chart, registerables } from 'chart.js';
import { StatsCardComponent } from './stats-card.component';
import type { PersonStatsResponse } from '../people-api.service';

Chart.register(...registerables);

const sample: PersonStatsResponse = {
  from: '2026-04-01',
  to: '2026-04-30',
  totals: {
    completedCount: 12,
    storyPointsSum: 28,
    actualStoryPointsSum: 35,
    estimateAccuracyRatio: 0.8,
  },
  byProject: [
    { projectKey: 'PAY', completedCount: 7, storyPointsSum: 16, actualStoryPointsSum: 20 },
    { projectKey: 'BILL', completedCount: 5, storyPointsSum: 12, actualStoryPointsSum: 15 },
  ],
  items: [],
  dataFreshness: { fetchedAt: new Date().toISOString(), source: 'live' },
};

describe('StatsCardComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [StatsCardComponent] }).compileComponents();
  });

  it('renders totals and by-project rows', () => {
    const fixture = TestBed.createComponent(StatsCardComponent);
    fixture.componentInstance.statsInput = sample;
    fixture.detectChanges();
    const txt = fixture.nativeElement.textContent as string;
    expect(txt).toContain('完成任務數');
    expect(txt).toContain('12');
    expect(txt).toContain('Story Points 加總');
    expect(txt).toContain('28');
    expect(txt).toContain('Actual SP 加總');
    expect(txt).toContain('35');
    expect(txt).toContain('0.8');
    expect(txt).toContain('PAY');
    expect(txt).toContain('BILL');
  });

  it('shows accuracy_na when estimateAccuracyRatio is null', () => {
    const fixture = TestBed.createComponent(StatsCardComponent);
    fixture.componentInstance.statsInput = { ...sample, totals: { ...sample.totals, estimateAccuracyRatio: null } };
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('尚無 Actual SP');
  });
});
