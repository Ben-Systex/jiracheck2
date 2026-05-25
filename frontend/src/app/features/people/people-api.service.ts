// T068：US3 三條 API 的 HTTP service

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../../core/http/api-config';
import type { DataFreshness } from '../../ui/freshness-bar/freshness-bar.component';

export interface PersonRef {
  accountId: string;
  displayName: string;
  email?: string | null;
  avatarUrl?: string | null;
}

export interface IssueSummary {
  key: string;
  summary: string;
  status: string;
  projectKey: string;
  assignee: PersonRef | null;
  priority: string | null;
  dueDate: string | null;
  storyPoints: number | null;
  actualStoryPoints: number | null;
  sprint: string | null;
  labels: string[];
}

export interface PeopleSearchResponse {
  items: PersonRef[];
}

export interface IssueListResponse {
  items: IssueSummary[];
  nextCursor: string | null;
  partialPermission: boolean;
  dataFreshness: DataFreshness;
}

export interface PersonStatsTotals {
  completedCount: number;
  storyPointsSum: number;
  actualStoryPointsSum: number;
  estimateAccuracyRatio: number | null;
}

export interface PersonStatsByProject {
  projectKey: string;
  completedCount: number;
  storyPointsSum: number;
  actualStoryPointsSum: number;
}

export interface PersonStatsResponse {
  from: string;
  to: string;
  totals: PersonStatsTotals;
  byProject: PersonStatsByProject[];
  items: IssueSummary[];
  dataFreshness: DataFreshness;
}

export type IssueStatusFilter = 'open' | 'done' | 'all';

export interface ListIssuesOpts {
  status?: IssueStatusFilter;
  pageSize?: number;
  cursor?: string;
  refresh?: boolean;
}

@Injectable({ providedIn: 'root' })
export class PeopleApiService {
  private readonly http = inject(HttpClient);
  private readonly base = inject(API_CONFIG).baseUrl;

  searchPeople(q: string): Observable<PeopleSearchResponse> {
    const params = new HttpParams().set('q', q);
    return this.http.get<PeopleSearchResponse>(`${this.base}/people/search`, {
      params,
      withCredentials: true,
    });
  }

  listIssues(accountId: string, opts: ListIssuesOpts = {}): Observable<IssueListResponse> {
    let params = new HttpParams();
    if (opts.status) params = params.set('status', opts.status);
    if (opts.pageSize) params = params.set('pageSize', String(opts.pageSize));
    if (opts.cursor) params = params.set('cursor', opts.cursor);
    if (opts.refresh) params = params.set('refresh', 'true');
    return this.http.get<IssueListResponse>(
      `${this.base}/people/${encodeURIComponent(accountId)}/issues`,
      { params, withCredentials: true },
    );
  }

  getStats(
    accountId: string,
    from: string,
    to: string,
    refresh = false,
  ): Observable<PersonStatsResponse> {
    let params = new HttpParams().set('from', from).set('to', to);
    if (refresh) params = params.set('refresh', 'true');
    return this.http.get<PersonStatsResponse>(
      `${this.base}/people/${encodeURIComponent(accountId)}/stats`,
      { params, withCredentials: true },
    );
  }
}
