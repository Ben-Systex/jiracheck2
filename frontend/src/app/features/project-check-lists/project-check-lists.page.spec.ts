// T057：project-check-lists.page 單元測試
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  provideHttpClientTesting,
  HttpTestingController,
} from '@angular/common/http/testing';
import { ProjectCheckListsPageComponent } from './project-check-lists.page';
import type { ProjectCheckListEntry } from './project-check-lists-api.service';

function mkEntry(over: Partial<ProjectCheckListEntry> = {}): ProjectCheckListEntry {
  return {
    id: 'pcl-1',
    projectKey: 'PRJ',
    addedBy: 'u-1',
    addedAt: '2026-06-01T00:00:00.000Z',
    note: null,
    ...over,
  };
}

describe('ProjectCheckListsPageComponent', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProjectCheckListsPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('載入後填入 items', async () => {
    const f = TestBed.createComponent(ProjectCheckListsPageComponent);
    f.detectChanges();
    const req = http.expectOne((r) => r.url.endsWith('/project-check-lists'));
    req.flush({ items: [mkEntry(), mkEntry({ id: 'pcl-2', projectKey: 'OTHER' })] });
    await f.whenStable();
    expect(f.componentInstance['items']().length).toBe(2);
  });

  it('新增 → POST + 重新 list', async () => {
    const f = TestBed.createComponent(ProjectCheckListsPageComponent);
    f.detectChanges();
    http.expectOne((r) => r.url.endsWith('/project-check-lists')).flush({ items: [] });
    await f.whenStable();

    f.componentInstance.newProjectKey = 'NEW';
    f.componentInstance.newNote = 'test';
    void f.componentInstance.onAdd({ preventDefault: () => undefined } as unknown as Event);

    const post = http.expectOne((r) => r.method === 'POST' && r.url.endsWith('/project-check-lists'));
    expect(post.request.body).toEqual({ projectKey: 'NEW', note: 'test' });
    post.flush(mkEntry({ id: 'pcl-2', projectKey: 'NEW', note: 'test' }));

    await f.whenStable();
    const reload = http.expectOne((r) => r.method === 'GET' && r.url.endsWith('/project-check-lists'));
    reload.flush({ items: [mkEntry({ projectKey: 'NEW', note: 'test' })] });
    await f.whenStable();

    expect(f.componentInstance.newProjectKey).toBe('');
    expect(f.componentInstance.newNote).toBe('');
  });

  it('409 衝突 → 顯示 errorMsg', async () => {
    const f = TestBed.createComponent(ProjectCheckListsPageComponent);
    f.detectChanges();
    http.expectOne((r) => r.url.endsWith('/project-check-lists')).flush({ items: [] });
    await f.whenStable();

    f.componentInstance.newProjectKey = 'DUP';
    void f.componentInstance.onAdd({ preventDefault: () => undefined } as unknown as Event);
    const post = http.expectOne((r) => r.method === 'POST' && r.url.endsWith('/project-check-lists'));
    post.flush({ cause: 'conflict' }, { status: 409, statusText: 'Conflict' });
    await f.whenStable();

    expect(f.componentInstance['errorMsg']()).toBeTruthy();
  });

  it('list 失敗 → state=error', async () => {
    const f = TestBed.createComponent(ProjectCheckListsPageComponent);
    f.detectChanges();
    http.expectOne((r) => r.url.endsWith('/project-check-lists')).flush({}, { status: 500, statusText: 'err' });
    await f.whenStable();
    expect(f.componentInstance['state']()).toBe('error');
  });

  it('空 projectKey 不送 POST', async () => {
    const f = TestBed.createComponent(ProjectCheckListsPageComponent);
    f.detectChanges();
    http.expectOne((r) => r.url.endsWith('/project-check-lists')).flush({ items: [] });
    await f.whenStable();

    f.componentInstance.newProjectKey = '   ';
    void f.componentInstance.onAdd({ preventDefault: () => undefined } as unknown as Event);
    // 不應有任何新 HTTP 請求
    http.verify();
  });
});
