// US4 bulk API service：preview / apply / getOperation

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../../core/http/api-config';

export type BulkTargetField = 'assignee' | 'due_date' | 'label' | 'priority' | 'sprint';

export interface BulkFilter {
  statuses?: string[];
  assigneeAccountIds?: string[];
  sprintNames?: string[];
  labels?: string[];
  issueTypes?: string[];
  dueDateRange?: { from?: string; to?: string };
}

export interface BulkPreviewRequest {
  projectKey: string;
  filter: BulkFilter;
  targetField: BulkTargetField;
  targetValue: unknown;
}

export interface BulkPreviewItem {
  issueKey: string;
  summary: string;
  currentValue: unknown;
  proposedValue: unknown;
  editableByUser: boolean;
}

export interface BulkPreviewResponse {
  previewToken: string;
  totalCount: number;
  items: BulkPreviewItem[];
}

export interface BulkApplyRequest {
  previewToken: string;
  confirmText: string;
  confirmCount: number;
}

export interface BulkApplyResponse {
  operationId: string;
}

export type BulkItemResult = 'success' | 'permission_denied' | 'version_conflict' | 'api_error';

export type BulkOperationStatus =
  | 'running'
  | 'success'
  | 'partial_failure'
  | 'failure'
  | 'cancelled';

export interface BulkOperationItem {
  issueKey: string;
  result: BulkItemResult;
  errorMessage: string | null;
  appliedAt: string | null;
}

export interface BulkOperationResponse {
  id: string;
  status: BulkOperationStatus;
  totalCount: number;
  successCount: number;
  failureCount: number;
  startedAt: string;
  completedAt: string | null;
  items: BulkOperationItem[];
}

@Injectable({ providedIn: 'root' })
export class BulkApiService {
  private readonly http = inject(HttpClient);
  private readonly base = inject(API_CONFIG).baseUrl;

  preview(req: BulkPreviewRequest): Observable<BulkPreviewResponse> {
    return this.http.post<BulkPreviewResponse>(`${this.base}/bulk/preview`, req, {
      withCredentials: true,
    });
  }

  apply(req: BulkApplyRequest): Observable<BulkApplyResponse> {
    return this.http.post<BulkApplyResponse>(`${this.base}/bulk/apply`, req, {
      withCredentials: true,
    });
  }

  getOperation(id: string): Observable<BulkOperationResponse> {
    return this.http.get<BulkOperationResponse>(`${this.base}/bulk/operations/${encodeURIComponent(id)}`, {
      withCredentials: true,
    });
  }
}
