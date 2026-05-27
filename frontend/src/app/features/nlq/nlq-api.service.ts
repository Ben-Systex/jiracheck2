// T055：NLQ API service

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../../core/http/api-config';
import type { DataFreshness } from '../../ui/freshness-bar/freshness-bar.component';

export type NlqIntent =
  | 'list_issues'
  | 'count_issues'
  | 'sum_story_points'
  | 'sum_actual_story_points'
  | 'avg_story_points'
  | 'avg_actual_story_points'
  | 'top_n_assignees'
  | 'group_count';

export interface QueryPlan {
  intent: NlqIntent;
  filters: Record<string, unknown>;
  groupBy?: string | null;
  topN?: number | null;
}

export type NlqStatus = 'ok' | 'clarification_needed' | 'partial_permission' | 'error';

export interface NlqResponse {
  explanationZh: string;
  plan: QueryPlan | null;
  dataFreshness?: DataFreshness;
  status: NlqStatus;
  clarificationQuestions?: string[];
  results?: Record<string, unknown>;
  latencyMs?: number;
}

export interface NlqRequest {
  question: string;
  executeImmediately?: boolean;
}

@Injectable({ providedIn: 'root' })
export class NlqApiService {
  private readonly http = inject(HttpClient);
  private readonly base = inject(API_CONFIG).baseUrl;

  query(req: NlqRequest): Observable<NlqResponse> {
    return this.http.post<NlqResponse>(`${this.base}/nlq/query`, req, {
      withCredentials: true,
    });
  }
}
