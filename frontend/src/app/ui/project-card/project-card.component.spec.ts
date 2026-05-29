import { TestBed } from '@angular/core/testing';
import { Chart, registerables } from 'chart.js';
import { ProjectCardComponent } from './project-card.component';
import type { ProjectCard } from '../../features/dashboard/projects-api.service';

// ng2-charts 不會自動 register controllers；spec 在 ng2-charts BaseChartDirective
// 之前必須先 Chart.register（與 app.config provideCharts 等效）
Chart.register(...registerables);

const sample: ProjectCard = {
  key: 'PAY',
  name: 'Payments',
  avatarUrl: null,
  openIssueCount: 17,
  sprintProgress: {
    completedSP: 13,
    totalSP: 21,
    sprintName: 'Sprint 8',
  },
  lastAccessedAt: new Date(Date.now() - 60_000).toISOString(),
};

describe('ProjectCardComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ProjectCardComponent] }).compileComponents();
  });

  it('renders project key, name, openIssueCount and sprint progress text', () => {
    const fixture = TestBed.createComponent(ProjectCardComponent);
    fixture.componentInstance.projectInput = sample;
    fixture.detectChanges();
    const txt = fixture.nativeElement.textContent as string;
    expect(txt).toContain('PAY');
    expect(txt).toContain('Payments');
    expect(txt).toContain('未完成 17');
    expect(txt).toContain('Sprint 進度 13 / 21');
  });

  it('emits open(key) on click', () => {
    const fixture = TestBed.createComponent(ProjectCardComponent);
    fixture.componentInstance.projectInput = sample;
    let opened: string | undefined;
    fixture.componentInstance.open.subscribe((k) => (opened = k));
    fixture.detectChanges();
    const article = fixture.nativeElement.querySelector('article') as HTMLElement;
    article.click();
    expect(opened).toBe('PAY');
  });

  it('emits open(key) on Enter keydown', () => {
    const fixture = TestBed.createComponent(ProjectCardComponent);
    fixture.componentInstance.projectInput = sample;
    let opened: string | undefined;
    fixture.componentInstance.open.subscribe((k) => (opened = k));
    fixture.detectChanges();
    const article = fixture.nativeElement.querySelector('article') as HTMLElement;
    article.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(opened).toBe('PAY');
  });

  it('renders sprint-none hint when no sprint progress', () => {
    const fixture = TestBed.createComponent(ProjectCardComponent);
    fixture.componentInstance.projectInput = { ...sample, sprintProgress: null };
    fixture.detectChanges();
    const txt = fixture.nativeElement.textContent as string;
    expect(txt).toContain('無進行中 Sprint');
  });
});
