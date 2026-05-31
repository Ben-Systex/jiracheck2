// T039：US2 ServiceLogs API service

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../../core/http/api-config';

export type ExtendedServiceId = 'CHKPROJ' | 'CHKISSUE' | 'SYSTEM_CLEANUP';
export type ServiceLogResult = 'success' | 'partial_failure' | 'failure' | 'skipped' | 'missed';
export type ServiceLogTriggeredBy = 'schedule' | 'manual' | 'system';

export interface ServiceLogSummary {
  id: string;
  scheduleId: string | null;
  serviceId: ExtendedServiceId;
  triggeredBy: ServiceLogTriggeredBy;
  startedAt: string;
  endedAt: string | null;
  result: ServiceLogResult;
  summary: string;
  ruleVersion: string | null;
}

export interface ServiceLogDetail extends ServiceLogSummary {
  notes: Record<string, unknown>;
  triggeredByUserId: string | null;
}

export interface ServiceLogListResponse {
  items: ServiceLogSummary[];
  nextCursor: string | null;
}

export interface ServiceLogListFilter {
  serviceId?: ExtendedServiceId;
  result?: ServiceLogResult;
  from?: string;
  to?: string;
  cursor?: string;
  pageSize?: number;
}

@Injectable({ providedIn: 'root' })
export class ServiceLogsApiService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  list(filter: ServiceLogListFilter = {}): Observable<ServiceLogListResponse> {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(filter)) {
      if (v !== undefined && v !== null && v !== '') params = params.set(k, String(v));
    }
    return this.http.get<ServiceLogListResponse>(`${this.api.baseUrl}/service-logs`, { params });
  }

  get(id: string): Observable<ServiceLogDetail> {
    return this.http.get<ServiceLogDetail>(`${this.api.baseUrl}/service-logs/${id}`);
  }

  /** 直接給 a tag 的 href（CSV stream） */
  exportUrl(filter: Omit<ServiceLogListFilter, 'cursor' | 'pageSize'> = {}): string {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filter)) {
      if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
    }
    const qs = params.toString();
    return `${this.api.baseUrl}/service-logs/export${qs ? `?${qs}` : ''}`;
  }
}
