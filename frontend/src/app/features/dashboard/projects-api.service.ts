// T039：US1 dashboard 對應 /projects/* 三條 API 的 HTTP service
// - 以 BaseUrl + httpClient 直打 backend
// - 回傳型別與 backend OpenAPI ProjectCard / ProjectDashboard 對齊
// - 提供 refresh=true 旗標（FR-003：freshness-bar 重新整理用）

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../../core/http/api-config';
import type { DataFreshness } from '../../ui/freshness-bar/freshness-bar.component';

export interface SprintProgress {
  completedSP: number;
  totalSP: number;
  sprintName?: string;
  endsAt?: string | null;
}

export interface ProjectCard {
  key: string;
  name: string;
  avatarUrl?: string | null;
  openIssueCount: number;
  sprintProgress: SprintProgress | null;
  lastAccessedAt?: string | null;
}

export interface ProjectListResponse {
  items: ProjectCard[];
  dataFreshness: DataFreshness;
}

export interface TopAssignee {
  person: { accountId: string; displayName: string };
  openIssueCount: number;
  totalSP: number;
}

export interface ProjectDashboard extends ProjectCard {
  topAssignees: TopAssignee[];
  dataFreshness: DataFreshness;
}

@Injectable({ providedIn: 'root' })
export class ProjectsApiService {
  private readonly http = inject(HttpClient);
  private readonly base = inject(API_CONFIG).baseUrl;

  recent(opts: { refresh?: boolean } = {}): Observable<ProjectListResponse> {
    return this.http.get<ProjectListResponse>(`${this.base}/projects/recent`, {
      params: this.buildParams(opts),
      withCredentials: true,
    });
  }

  search(q: string, opts: { refresh?: boolean } = {}): Observable<ProjectListResponse> {
    const params = this.buildParams(opts).set('q', q);
    return this.http.get<ProjectListResponse>(`${this.base}/projects/search`, {
      params,
      withCredentials: true,
    });
  }

  getOne(key: string): Observable<ProjectDashboard> {
    return this.http.get<ProjectDashboard>(`${this.base}/projects/${encodeURIComponent(key)}`, {
      withCredentials: true,
    });
  }

  private buildParams(opts: { refresh?: boolean }): HttpParams {
    let p = new HttpParams();
    if (opts.refresh) p = p.set('refresh', 'true');
    return p;
  }
}
